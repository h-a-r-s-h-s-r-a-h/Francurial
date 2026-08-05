from pathlib import Path

from fastapi import APIRouter, WebSocket
from fastapi.responses import HTMLResponse

from app.controllers.live_controller import proxy_live_session

router = APIRouter(prefix="/v1/live", tags=["live"])

_VIEWER_HTML = (Path(__file__).resolve().parent.parent / "static" / "live_view.html").read_text()


@router.get("/{task_id}/view", response_class=HTMLResponse)
async def live_view_page(task_id: str, token: str):
    """The actual browser-facing entrypoint — what `live_url` points to.

    A bare WebSocket endpoint (below) can't be "opened" by pasting a URL into
    a browser: the address bar always does a plain HTTP GET, never a WS
    upgrade handshake, so it 404s with nothing served here. This page's own
    JS reads task_id/token from its URL and opens the real WS connection.
    """
    return _VIEWER_HTML


@router.websocket("/{task_id}")
async def live_ws(websocket: WebSocket, task_id: str, token: str):
    """Real-time transport the viewer page's JS connects to.

    Signed+expiring token in the query string is the only auth — anyone with
    the exact live_url returned from task creation can view/control until it
    expires. Proxies frames+input to whichever worker pod currently owns the
    task, so callers never need to know pod addressing.
    """
    await proxy_live_session(websocket, task_id, token)
