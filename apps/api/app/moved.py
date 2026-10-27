"""'We moved' mode (block 3.18): while SERVER_MOVED_TO holds the new server's address, this API
only points there. /api/health still answers (so monitoring and the app's server check work),
invite pages and their assets (/convite/..., /static/..., also linked from e-mails already sent)
redirect for good, every other request gets a readable 503, and WebSockets close with the same
message. Logins are kept: a 503 isn't a 401, so the app holds on to its session."""

from starlette.datastructures import URL
from starlette.responses import JSONResponse, RedirectResponse
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.websockets import WebSocket

from app.config import get_settings

MOVED_MESSAGE = "O Aureum mudou de servidor. Atualize o app."
CLOSE_SERVER_MOVED = 4010
REDIRECTED_PREFIXES = ("/convite/", "/static/")


class ServerMovedMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        target = get_settings().server_moved_to.strip().rstrip("/")
        if not target or scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            # Accept first: a close before the handshake reaches the client without its reason.
            websocket = WebSocket(scope, receive, send)
            await websocket.accept()
            await websocket.close(code=CLOSE_SERVER_MOVED, reason=MOVED_MESSAGE)
            return
        path = scope["path"]
        if path == "/api/health":
            await self.app(scope, receive, send)
            return
        if path.startswith(REDIRECTED_PREFIXES):
            query = URL(scope=scope).query
            response = RedirectResponse(f"{target}{path}" + (f"?{query}" if query else ""), status_code=301)
        else:
            response = JSONResponse({"detail": MOVED_MESSAGE}, status_code=503)
        await response(scope, receive, send)
