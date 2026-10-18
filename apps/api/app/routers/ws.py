import asyncio
import json
import uuid
from typing import Any

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app import calls, presence, voice
from app.access import channel_member_ids, server_member_ids
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


async def _handle_voice_update(websocket: WebSocket, user_id: uuid.UUID, data: Any) -> None:
    try:
        update = VoiceUpdate.model_validate(data)
    except ValidationError:
        return await _send_error(websocket, "Invalid voice.update payload")

    if update.channel_id is None:
        return await voice.leave(user_id, _recipients)

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
    await voice.set_state(state, scope, _recipients)
    if scope.kind == "dm":
        await calls.joined(scope.id, user_id)


async def _handle_overview_watch(websocket: WebSocket, user_id: uuid.UUID, data: Any) -> None:
    """The client opened (server_id) or closed (null) a server's overview: it gets that
    server's screen-share thumbnails, starting with the current ones."""
    raw = data.get("server_id") if isinstance(data, dict) else None
    if raw is None:
        return broker.watch(None, websocket)
    try:
        server_id = uuid.UUID(str(raw))
    except ValueError:
        return await _send_error(websocket, "Invalid overview.watch payload")
    async with SessionLocal() as session:
        visible = await visible_channel_ids(session, server_id, user_id)
        if await session.get(ServerMember, (server_id, user_id)) is None:
            return await _send_error(websocket, "Server not found")
    broker.watch(server_id, websocket)
    for event in await voice.get_thumbnails(server_id):
        if event["channel_id"] and uuid.UUID(event["channel_id"]) in visible:
            await websocket.send_json({"type": "screen.thumbnail", "data": event})


async def _handle_thumbnail(user_id: uuid.UUID, data: Any) -> None:
    # Dropped silently when invalid, throttled or not sharing: the client just sends the next one.
    image = data.get("image") if isinstance(data, dict) else None
    if voice.valid_thumbnail(image):
        await voice.store_thumbnail(user_id, image, _viewers_of)


async def _send_error(websocket: WebSocket, message: str) -> None:
    await websocket.send_json({"type": "error", "data": {"message": message}})


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query("")) -> None:
    # CORS doesn't apply to WebSockets: refuse browser pages from other origins (the packaged
    # app sends "file://"). Non-browser clients send no Origin and still need a valid token.
    origin = websocket.headers.get("origin")
    if origin is not None and origin not in get_settings().ws_origins:
        await websocket.close(code=CLOSE_FORBIDDEN_ORIGIN)
        return
    await websocket.accept()
    user_id = decode_token(token, "access")
    chosen = UserStatus.online
    if user_id is not None:
        async with SessionLocal() as session:
            if await session.get(User, user_id) is None:
                user_id = None
            elif settings := await session.get(UserSettings, user_id):
                chosen = settings.status
    if user_id is None:
        await websocket.close(code=CLOSE_UNAUTHORIZED)
        return

    await broker.ensure_listening()
    connection_id = uuid.uuid4().hex
    broker.register(user_id, websocket)
    try:
        await presence.set_chosen(user_id, chosen)
        await broker.heartbeat(user_id, connection_id)
        await presence.announce(user_id)
        await websocket.send_json({"type": "ready", "data": {"user_id": str(user_id)}})

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
                await _handle_voice_update(websocket, user_id, message.get("data"))
            elif message.get("type") == "overview.watch":
                await _handle_overview_watch(websocket, user_id, message.get("data"))
            elif message.get("type") == "screen.thumbnail":
                await _handle_thumbnail(user_id, message.get("data"))
            elif message.get("type") == "presence.idle":
                # The client's PC has had no input for a while (or has again).
                data = message.get("data")
                idle = isinstance(data, dict) and data.get("idle") is True
                await presence.set_idle(user_id, connection_id, idle)
                await presence.announce(user_id)
    except WebSocketDisconnect:
        pass
    finally:
        broker.unregister(user_id, websocket)
        await presence.forget_connection(user_id, connection_id)
        if await broker.disconnect(user_id, connection_id):
            # Last connection gone: the user can't be in a call anymore.
            await voice.leave(user_id, _recipients)
        await presence.announce(user_id)
