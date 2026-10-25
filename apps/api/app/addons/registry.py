"""The addons this API runs. Adding one: create app/addons/<key>/, list its manifest here and
its migrations folder in alembic.ini (version_locations)."""

import logging
import uuid
from collections.abc import Iterable
from typing import Any

from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from app.addons.base import AddonManifest, AddonSocket, SocketError
from app.addons.kanban import manifest as kanban
from app.addons.polls import manifest as polls
from app.addons.whiteboard import manifest as whiteboard

ADDONS: dict[str, AddonManifest] = {a.key: a for a in (kanban, whiteboard, polls)}

log = logging.getLogger(__name__)

# Each connection's AddonSocket per addon, once it sent that addon something.
_sockets: dict[WebSocket, dict[str, AddonSocket]] = {}


def get_addon(key: str | None) -> AddonManifest | None:
    return ADDONS.get(key) if key else None


async def cleanup(session: AsyncSession, channels: Iterable[tuple[str | None, uuid.UUID]]) -> list[str]:
    """Lets each addon drop its data for channels about to be deleted: (addon_key, channel_id)
    pairs. Runs in the caller's transaction and returns the stored files to delete after it
    commits."""
    by_addon: dict[str, list[uuid.UUID]] = {}
    for key, channel_id in channels:
        if key:
            by_addon.setdefault(key, []).append(channel_id)
    files: list[str] = []
    for key, ids in by_addon.items():
        addon = ADDONS.get(key)
        if addon and addon.on_cleanup:
            files += await addon.on_cleanup(session, ids) or []
    return files


async def handle_socket(websocket: WebSocket, user_id: uuid.UUID, type_: str, data: Any) -> str | None:
    """Runs the handler of an `addon.<key>.<name>` message from a client. Returns an error message
    for the client, if any."""
    _, key, name = (type_.split(".", 2) + ["", ""])[:3]
    addon = ADDONS.get(key)
    handler = addon.socket.get(name) if addon else None
    if addon is None or handler is None:
        return f"Unknown message: {type_}"
    socket = _sockets.setdefault(websocket, {}).get(key)
    if socket is None:
        socket = _sockets[websocket][key] = AddonSocket(addon, websocket, user_id, {})
    try:
        await handler(socket, data)
    except SocketError as e:
        return str(e)
    return None


async def socket_closed(websocket: WebSocket) -> None:
    """Tells the addons a connection that talked to them is gone."""
    for key, socket in _sockets.pop(websocket, {}).items():
        hook = ADDONS[key].on_socket_close
        if hook is None:
            continue
        try:
            await hook(socket)
        except Exception:
            log.exception("The %s addon failed to handle a closed connection", key)
