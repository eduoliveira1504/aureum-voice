import asyncio
import json
import uuid
from typing import Any

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app import voice
from app.access import co_member_ids, server_member_ids
from app.config import get_settings
from app.db import SessionLocal
from app.models import Channel, ChannelType, ServerMember, User
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


async def _recipients(server_id: uuid.UUID) -> list[uuid.UUID]:
    async with SessionLocal() as session:
        return await server_member_ids(session, server_id)


async def _publish_presence(user_id: uuid.UUID, online: bool) -> None:
    async with SessionLocal() as session:
        recipients = await co_member_ids(session, user_id)
    await broker.publish("presence.updated", {"user_id": str(user_id), "online": online}, recipients)


async def _handle_voice_update(websocket: WebSocket, user_id: uuid.UUID, data: Any) -> None:
    try:
        update = VoiceUpdate.model_validate(data)
    except ValidationError:
        return await _send_error(websocket, "Invalid voice.update payload")

    if update.channel_id is None:
        return await voice.leave(user_id, _recipients)

    async with SessionLocal() as session:
        channel = await session.get(Channel, update.channel_id)
        allowed = (
            channel is not None
            and channel.type == ChannelType.voice
            and channel.server_id is not None
            and await session.get(ServerMember, (channel.server_id, user_id)) is not None
        )
    if not allowed:
        return await _send_error(websocket, "Voice channel not found")

    assert channel is not None and channel.server_id is not None
    state = voice.VoiceState(user_id=user_id, **update.model_dump())
    await voice.set_state(state, channel.server_id, _recipients)


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
        if await session.get(ServerMember, (server_id, user_id)) is None:
            return await _send_error(websocket, "Server not found")
    broker.watch(server_id, websocket)
    for event in await voice.get_thumbnails(server_id):
        await websocket.send_json({"type": "screen.thumbnail", "data": event})


async def _handle_thumbnail(user_id: uuid.UUID, data: Any) -> None:
    # Dropped silently when invalid, throttled or not sharing: the client just sends the next one.
    image = data.get("image") if isinstance(data, dict) else None
    if voice.valid_thumbnail(image):
        await voice.store_thumbnail(user_id, image)


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
    if user_id is not None:
        async with SessionLocal() as session:
            if await session.get(User, user_id) is None:
                user_id = None
    if user_id is None:
        await websocket.close(code=CLOSE_UNAUTHORIZED)
        return

    await broker.ensure_listening()
    connection_id = uuid.uuid4().hex
    broker.register(user_id, websocket)
    try:
        if await broker.heartbeat(user_id, connection_id):
            await _publish_presence(user_id, True)
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
    except WebSocketDisconnect:
        pass
    finally:
        broker.unregister(user_id, websocket)
        if await broker.disconnect(user_id, connection_id):
            # Last connection gone: the user can't be in a call anymore.
            await voice.leave(user_id, _recipients)
            await _publish_presence(user_id, False)
