"""Live drawing over the WebSocket: strokes as they're drawn, cursors and following someone.

Nothing here is saved. The app also saves its changes through the HTTP route (every second or
so), which is what lasts and what checks permissions every time. This path only makes others
see a stroke while it's being drawn, so it checks access when a board is joined and again every
ACCESS_TTL, and drops what doesn't look right instead of answering.

Client messages (`addon.whiteboard.<name>`):
- join {channel_id, board_id | null, origin}: open a board (null: close it). The others get
  `peer.joined` and answer with a pointer, so everyone shows up right away.
- update {board_id, elements, origin}: elements being drawn; relayed as `live`.
- pointer {board_id, x, y, button, tool?, selected?, viewport?, origin}: relayed as `pointer`.
  `viewport` (what the sender sees) is what following someone uses.
A closed connection or a closed board sends `peer.left`.
"""

import json
import math
import time
import uuid
from typing import Any

from sqlalchemy import select

from app.addons.base import AddonSocket, SocketError
from app.addons.whiteboard.models import ELEMENT_TYPES, WhiteboardBoard
from app.db import SessionLocal
from app.permissions import channel_viewers

# How long a join's access check (and the list of who can see the channel) is trusted.
ACCESS_TTL = 15.0
MAX_LIVE_BYTES = 512 * 1024
MAX_LIVE_ELEMENTS = 200
# Per connection: more than this many messages a second are dropped.
MAX_RATE = 40


def _uuid(raw: Any) -> uuid.UUID:
    try:
        return uuid.UUID(str(raw))
    except ValueError:
        raise SocketError("Invalid whiteboard message") from None


def _origin(data: dict[str, Any]) -> str | None:
    origin = data.get("origin")
    return origin[:64] if isinstance(origin, str) else None


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) and math.isfinite(value) else None


def _throttled(socket: AddonSocket) -> bool:
    now = time.monotonic()
    window = socket.state.setdefault("rate", [now, 0])
    if now - window[0] >= 1:
        window[0], window[1] = now, 0
    window[1] += 1
    return window[1] > MAX_RATE


async def _check(socket: AddonSocket, channel_id: uuid.UUID, board_id: uuid.UUID) -> None:
    """Loads (or refreshes) what this connection may do on the board it joined."""
    async with SessionLocal() as session:
        ctx = await socket.channel(session, channel_id)
        exists = await session.scalar(
            select(WhiteboardBoard.id).where(WhiteboardBoard.id == board_id, WhiteboardBoard.workspace_id == ctx.workspace_id)
        )
        if exists is None:
            raise SocketError("Board not found")
        socket.state["board"] = {
            "channel_id": channel_id,
            "board_id": board_id,
            "can_edit": ctx.can("edit"),
            "viewers": set(await channel_viewers(session, ctx.channel)),
            "checked": time.monotonic(),
        }


async def _joined(socket: AddonSocket, data: Any) -> dict[str, Any] | None:
    """The board this connection has open, if the message is about it, with fresh access."""
    joined = socket.state.get("board")
    if joined is None or not isinstance(data, dict) or str(data.get("board_id")) != str(joined["board_id"]):
        return None
    if time.monotonic() - joined["checked"] > ACCESS_TTL:
        try:
            await _check(socket, joined["channel_id"], joined["board_id"])
        except SocketError:
            await _leave(socket)
            raise
        joined = socket.state["board"]
    return joined


async def _relay(socket: AddonSocket, joined: dict[str, Any], event: str, data: dict[str, Any]) -> None:
    payload = {"channel_id": str(joined["channel_id"]), "board_id": str(joined["board_id"]), "user_id": str(socket.user_id), **data}
    await socket.relay(joined["board_id"], event, payload, joined["viewers"])


async def _leave(socket: AddonSocket) -> None:
    joined = socket.state.pop("board", None)
    socket.join(())
    if joined is not None:
        await _relay(socket, joined, "peer.left", {"origin": socket.state.get("origin")})


async def join(socket: AddonSocket, data: Any) -> None:
    if not isinstance(data, dict):
        raise SocketError("Invalid whiteboard message")
    await _leave(socket)
    if data.get("board_id") is None:
        return
    await _check(socket, _uuid(data.get("channel_id")), _uuid(data.get("board_id")))
    socket.state["origin"] = _origin(data)
    joined = socket.state["board"]
    socket.join([joined["board_id"]])
    await _relay(socket, joined, "peer.joined", {"origin": socket.state["origin"]})


async def update(socket: AddonSocket, data: Any) -> None:
    if _throttled(socket):
        return
    joined = await _joined(socket, data)
    if joined is None or not joined["can_edit"]:
        return
    elements = data.get("elements")
    if not isinstance(elements, list) or not 0 < len(elements) <= MAX_LIVE_ELEMENTS:
        return
    if not all(isinstance(e, dict) and isinstance(e.get("id"), str) and isinstance(e.get("version"), int) for e in elements):
        return
    if any(e.get("type") not in ELEMENT_TYPES for e in elements):
        return
    if len(json.dumps(elements, separators=(",", ":"))) > MAX_LIVE_BYTES:
        return
    await _relay(socket, joined, "live", {"elements": elements, "origin": _origin(data)})


async def pointer(socket: AddonSocket, data: Any) -> None:
    if _throttled(socket):
        return
    joined = await _joined(socket, data)
    if joined is None:
        return
    x, y = _number(data.get("x")), _number(data.get("y"))
    if x is None or y is None:
        return
    out: dict[str, Any] = {
        "x": x,
        "y": y,
        "button": "down" if data.get("button") == "down" else "up",
        "tool": "laser" if data.get("tool") == "laser" else "pointer",
        "origin": _origin(data),
    }
    selected = data.get("selected")
    if isinstance(selected, list):
        out["selected"] = [s for s in selected[:100] if isinstance(s, str) and len(s) <= 64]
    viewport = data.get("viewport")
    if isinstance(viewport, dict):
        numbers = {k: _number(viewport.get(k)) for k in ("x", "y", "width", "height", "zoom")}
        if all(v is not None for v in numbers.values()):
            out["viewport"] = numbers
    await _relay(socket, joined, "pointer", out)


async def closed(socket: AddonSocket) -> None:
    await _leave(socket)


HANDLERS = {"join": join, "update": update, "pointer": pointer}
