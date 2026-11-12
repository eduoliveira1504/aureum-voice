import asyncio
import json
import re
import uuid
from collections import Counter
from typing import Any

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app import calls, presence, voice
from app.addons import registry as addons
from app.access import audience_ids, channel_member_ids, server_member_ids
from app.permissions import Perm, channel_viewers, server_access, visible_channel_ids
from app.config import get_settings
from app.db import SessionLocal
from app.dms import DM_TYPES
from app.models import Channel, ChannelMember, ChannelType, ServerMember, User, UserSettings, UserStatus
from app.realtime import broker
from app.security import decode_token

router = APIRouter()

# Clients ping every ~25s; a connection silent for this long is considered dead.
RECEIVE_TIMEOUT_SECONDS = 60
# Close code telling the client its token is invalid/expired, so it refreshes before reconnecting.
CLOSE_UNAUTHORIZED = 4401
CLOSE_FORBIDDEN_ORIGIN = 1008  # policy violation


# The app's install id (?device=), a random id it keeps; anything else counts as none.
DEVICE_PATTERN = re.compile(r"[A-Za-z0-9-]{8,64}")

# Open connections per (user, device) and per user, in this process (the API runs as one), so a
# dropped device that comes back within the grace keeps its place in the call.
_device_connections: Counter[tuple[uuid.UUID, str]] = Counter()
_user_connections: Counter[uuid.UUID] = Counter()


def is_connected(user_id: uuid.UUID, device: str | None) -> bool:
    """Whether that device (None: any device of the user) has a connection open here."""
    return (_device_connections[(user_id, device)] if device else _user_connections[user_id]) > 0


async def run_voice_sweeper() -> None:
    """Takes out of voice who dropped and didn't come back (also after a restart)."""
    await voice.run_sweeper(is_connected, _recipients)


class VoiceUpdate(voice.VoiceFlags):
    """Sent by the client when it joins/leaves a voice channel or toggles mic/camera/screen."""

    channel_id: uuid.UUID | None


async def _recipients(scope: voice.Scope, channel_id: uuid.UUID) -> list[uuid.UUID]:
    """Who sees voice changes in a channel: the server members who can see it, or the DM's."""
    async with SessionLocal() as session:
        if scope.kind == "dm":
            return await channel_member_ids(session, scope.id)
        channel = await session.get(Channel, channel_id)
        if channel is None:  # deleted meanwhile
            return await server_member_ids(session, scope.id)
        return await channel_viewers(session, channel)


async def _viewers_of(channel_id: uuid.UUID) -> list[uuid.UUID]:
    async with SessionLocal() as session:
        channel = await session.get(Channel, channel_id)
        return await channel_viewers(session, channel) if channel and channel.server_id else []


async def _voice_scope(channel_id: uuid.UUID, user_id: uuid.UUID) -> tuple[voice.Scope, Perm | None, ServerMember | None] | None:
    """Where joining this channel puts the user: a server voice channel they can connect to
    (with their permissions there and their membership, for moderation flags), or a DM/group
    of theirs with a call in progress (permissions None: anything goes). None if they can't
    join it."""
    async with SessionLocal() as session:
        channel = await session.get(Channel, channel_id)
        if channel is None:
            return None
        if channel.type == ChannelType.voice and channel.server_id is not None:
            member = await session.get(ServerMember, (channel.server_id, user_id))
            if member is None:
                return None
            perms = (await server_access(session, channel.server_id, user_id, [channel.id])).channel(channel)
            return (voice.server_scope(channel.server_id), perms, member) if perms & Perm.CONNECT else None
        if channel.type in DM_TYPES and await session.get(ChannelMember, (channel_id, user_id)) is not None:
            if await calls.active_call(session, channel_id) is not None:
                return voice.dm_scope(channel_id), None, None
        return None


async def _handle_voice_update(websocket: WebSocket, user_id: uuid.UUID, device: str | None, data: Any) -> None:
    try:
        update = VoiceUpdate.model_validate(data)
    except ValidationError:
        return await _send_error(websocket, "Invalid voice.update payload")

    if update.channel_id is None:
        # From another device than the one in the call, this changes nothing; nor from an app
        # from before devices (no id) while a device holds the call.
        if device is None and await voice.device_of(user_id) is not None:
            return
        await voice.leave(user_id, _recipients, device)
        return

    found = await _voice_scope(update.channel_id, user_id)
    if found is None:
        return await _send_error(websocket, "Voice channel not found")
    scope, perms, member = found
    if perms is not None:
        # What others see matches what the media server lets them publish.
        update.muted = update.muted or not perms & Perm.SPEAK
        update.camera = update.camera and bool(perms & Perm.VIDEO)
        update.screen = update.screen and bool(perms & Perm.STREAM)
    state = voice.VoiceState(user_id=user_id, **update.model_dump())
    if member is not None:
        voice.apply_moderation(state, muted=member.voice_muted, deafened=member.voice_deafened)
    if device is None:
        await voice.forget_device(user_id)
    await voice.set_state(state, scope, _recipients, device)
    if scope.kind == "dm":
        await calls.joined(scope.id, user_id)


# The Home hub watches the servers of its live cards on screen, at most this many.
HOME_WATCH_MAX = 6


async def _send_thumbnails(websocket: WebSocket, user_id: uuid.UUID, server_ids: set[uuid.UUID]) -> None:
    """The current thumbnails of these servers, of rooms the user can see."""
    for server_id in server_ids:
        async with SessionLocal() as session:
            visible = await visible_channel_ids(session, server_id, user_id)
        for event in await voice.get_thumbnails(server_id):
            if event["channel_id"] and uuid.UUID(event["channel_id"]) in visible:
                await websocket.send_json({"type": "screen.thumbnail", "data": event})


async def _handle_overview_watch(websocket: WebSocket, user_id: uuid.UUID, data: Any) -> None:
    """The client opened (server_id) or closed (null) a server's overview: it gets that
    server's screen-share thumbnails, starting with the current ones."""
    raw = data.get("server_id") if isinstance(data, dict) else None
    if raw is None:
        broker.watch(websocket, "overview", ())
        return
    try:
        server_id = uuid.UUID(str(raw))
    except ValueError:
        return await _send_error(websocket, "Invalid overview.watch payload")
    async with SessionLocal() as session:
        if await session.get(ServerMember, (server_id, user_id)) is None:
            return await _send_error(websocket, "Server not found")
    broker.watch(websocket, "overview", [server_id])
    await _send_thumbnails(websocket, user_id, {server_id})


async def _handle_home_watch(websocket: WebSocket, user_id: uuid.UUID, data: Any) -> None:
    """The Home hub shows live cards of these servers (empty: the hub was closed): it gets
    their thumbnails, starting with the current ones. Servers the user isn't in are skipped."""
    raw = data.get("server_ids") if isinstance(data, dict) else None
    try:
        if not isinstance(raw, list) or len(raw) > HOME_WATCH_MAX:
            raise ValueError
        server_ids = {uuid.UUID(str(r)) for r in raw}
    except ValueError:
        return await _send_error(websocket, "Invalid home.watch payload")
    async with SessionLocal() as session:
        mine = {s for s in server_ids if await session.get(ServerMember, (s, user_id)) is not None}
    broker.watch(websocket, "home", mine)
    await _send_thumbnails(websocket, user_id, mine)


async def _handle_thumbnail(user_id: uuid.UUID, data: Any) -> None:
    # Dropped silently when invalid, throttled or not sharing: the client just sends the next one.
    image = data.get("image") if isinstance(data, dict) else None
    if voice.valid_thumbnail(image):
        await voice.store_thumbnail(user_id, image, _viewers_of)


ACTIVITY_NAME_MAX = 64


async def _handle_activity(user_id: uuid.UUID, connection_id: str, device: str | None, data: Any) -> None:
    """The client's PC started (name) or stopped (null) playing a game. Only the name is sent."""
    name = data.get("name") if isinstance(data, dict) else None
    if isinstance(name, str):
        name = " ".join(name.split())[:ACTIVITY_NAME_MAX] or None
    else:
        name = None
    # Apps with a device id re-confirm their activity every couple of minutes, so it can expire.
    await presence.set_activity(user_id, connection_id, name, expires=device is not None)
    await presence.announce_activity(user_id)


async def _send_activity_snapshot(websocket: WebSocket, user_id: uuid.UUID) -> None:
    """What everyone the user sees is playing right now; updates follow as activity.updated."""
    async with SessionLocal() as session:
        ids = await audience_ids(session, user_id)
    current = await presence.activities(ids)
    data = {str(u): activity for u, activity in current.items()}
    await websocket.send_json({"type": "activity.snapshot", "data": data})


async def _send_error(websocket: WebSocket, message: str) -> None:
    await websocket.send_json({"type": "error", "data": {"message": message}})


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(""), device: str = Query("")) -> None:
    # CORS doesn't apply to WebSockets: refuse browser pages from other origins (the packaged
    # app sends "file://"). Non-browser clients send no Origin and still need a valid token.
    origin = websocket.headers.get("origin")
    if origin is not None and origin not in get_settings().ws_origins:
        await websocket.close(code=CLOSE_FORBIDDEN_ORIGIN)
        return
    await websocket.accept()
    claims = decode_token(token, "access")
    user_id = claims.user_id if claims else None
    chosen = UserStatus.online
    if claims is not None:
        async with SessionLocal() as session:
            user = await session.get(User, claims.user_id)
            # Ended sessions and accounts that must first replace their password get nothing.
            if user is None or user.session_epoch != claims.epoch or user.must_change_password or user.deletion_due_at:
                user_id = None
            elif settings := await session.get(UserSettings, user.id):
                chosen = settings.status
    if user_id is None:
        await websocket.close(code=CLOSE_UNAUTHORIZED)
        return

    await broker.ensure_listening()
    connection_id = uuid.uuid4().hex
    device_id = device if DEVICE_PATTERN.fullmatch(device) else None
    broker.register(user_id, websocket, claims.epoch if claims else 0)
    _user_connections[user_id] += 1
    if device_id:
        _device_connections[(user_id, device_id)] += 1
    try:
        await presence.set_chosen(user_id, chosen)
        await broker.heartbeat(user_id, connection_id)
        await presence.announce(user_id)
        # `device` echoes the app's install id; `voice_device` is the one in a call, if any.
        ready = {"user_id": str(user_id), "device": device_id, "voice_device": await voice.device_of(user_id)}
        await websocket.send_json({"type": "ready", "data": ready})
        await _send_activity_snapshot(websocket, user_id)

        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), RECEIVE_TIMEOUT_SECONDS)
            except TimeoutError:
                break
            await broker.heartbeat(user_id, connection_id)
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(message, dict):
                continue
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong", "data": None})
            elif message.get("type") == "voice.update":
                await _handle_voice_update(websocket, user_id, device_id, message.get("data"))
            elif message.get("type") == "overview.watch":
                await _handle_overview_watch(websocket, user_id, message.get("data"))
            elif message.get("type") == "home.watch":
                await _handle_home_watch(websocket, user_id, message.get("data"))
            elif message.get("type") == "screen.thumbnail":
                await _handle_thumbnail(user_id, message.get("data"))
            elif message.get("type") == "presence.idle":
                # The client's PC has had no input for a while (or has again).
                data = message.get("data")
                idle = isinstance(data, dict) and data.get("idle") is True
                await presence.set_idle(user_id, connection_id, idle)
                await presence.announce(user_id)
            elif message.get("type") == "activity.set":
                await _handle_activity(user_id, connection_id, device_id, message.get("data"))
            elif isinstance(message.get("type"), str) and message["type"].startswith("addon."):
                if error := await addons.handle_socket(websocket, user_id, message["type"], message.get("data")):
                    await _send_error(websocket, error)
    except WebSocketDisconnect:
        pass
    finally:
        await addons.socket_closed(websocket)
        broker.unregister(user_id, websocket)
        await presence.forget_connection(user_id, connection_id)
        _user_connections[user_id] -= 1
        if not _user_connections[user_id]:
            del _user_connections[user_id]
        if device_id:
            _device_connections[(user_id, device_id)] -= 1
            if not _device_connections[(user_id, device_id)]:
                del _device_connections[(user_id, device_id)]
        last = await broker.disconnect(user_id, connection_id)
        holder = await voice.device_of(user_id)
        if holder is not None:
            if holder == device_id and not is_connected(user_id, device_id):
                # The device in the call dropped: a short grace to come back (a network blip).
                await voice.leave_unless_back(user_id)
        elif last:
            # An app from before devices: its last connection gone, it can't be in a call.
            await voice.leave(user_id, _recipients)
        await presence.announce(user_id)
        await presence.announce_activity(user_id)
