import asyncio
import logging

import websockets
from fastapi import WebSocket, WebSocketDisconnect

from app.core.security import verify_live_token
from app.services.queue_service import get_worker_addr

logger = logging.getLogger("live")


async def proxy_live_session(ws: WebSocket, task_id: str, token: str) -> None:
    if not verify_live_token(task_id, token):
        await ws.close(code=4401, reason="invalid or expired live token")
        return

    worker_addr = get_worker_addr(task_id)
    if not worker_addr:
        await ws.close(code=4404, reason="task has no active session yet (not started, or already finished)")
        return

    await ws.accept()

    upstream_url = f"ws://{worker_addr}/internal/live/{task_id}"
    try:
        async with websockets.connect(upstream_url, max_size=10 * 1024 * 1024) as upstream:

            async def downstream_to_upstream():
                try:
                    while True:
                        msg = await ws.receive_text()
                        await upstream.send(msg)
                except WebSocketDisconnect:
                    pass

            async def upstream_to_downstream():
                try:
                    async for msg in upstream:
                        await ws.send_text(msg)
                except websockets.ConnectionClosed:
                    pass

            done, pending = await asyncio.wait(
                [asyncio.create_task(downstream_to_upstream()), asyncio.create_task(upstream_to_downstream())],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()

            # Forward whatever code/reason the worker closed with (e.g. 4001
            # "session not ready yet") to the browser — without this, the
            # client only ever sees a generic close and can't tell a
            # transient "retry me" state apart from a permanent failure.
            try:
                await ws.close(code=upstream.close_code or 1000, reason=upstream.close_reason or "")
            except RuntimeError:
                pass  # browser side already disconnected first
    except OSError as exc:
        logger.warning("could not reach worker %s for task %s: %s", worker_addr, task_id, exc)
        await ws.close(code=4502, reason="worker session unreachable")
