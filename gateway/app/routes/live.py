from fastapi import APIRouter, WebSocket

from app.controllers.live_controller import proxy_live_session

router = APIRouter(prefix="/v1/live", tags=["live"])


@router.websocket("/{task_id}")
async def live_ws(websocket: WebSocket, task_id: str, token: str):
    """Public entrypoint the frontend/Postman-shared link connects to.

    Signed+expiring token in the query string is the only auth — anyone with
    the exact live_url returned from task creation can view/control until it
    expires. Proxies frames+input to whichever worker pod currently owns the
    task, so callers never need to know pod addressing.
    """
    await proxy_live_session(websocket, task_id, token)
