"""Voice: LiveKit access tokens and who-is-in-which-voice-channel state.

Clients report their own voice state (channel, mute, deafen, camera, screen) over the
WebSocket; it's stored in Redis per server and broadcast as `voice.state` events. A user
is in at most one voice channel, and drops out when their last connection closes.
"""

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

import jwt
from pydantic import BaseModel

from app.config import get_settings
from app.realtime import broker

# Returns who should be told about voice changes in a server (its members).
RecipientsFor = Callable[[uuid.UUID], Awaitable[list[uuid.UUID]]]


class VoiceFlags(BaseModel):
    muted: bool = False
    deafened: bool = False
    camera: bool = False
    screen: bool = False


class VoiceState(VoiceFlags):
    user_id: uuid.UUID
    channel_id: uuid.UUID


def livekit_token(*, room: str, identity: str, name: str) -> str:
    """LiveKit access token: a JWT signed with the API secret (see docs.livekit.io)."""
    settings = get_settings()
    now = datetime.now(UTC)
    claims = {
        "iss": settings.livekit_api_key,
        "sub": identity,
        "name": name,
        "nbf": now,
        "exp": now + timedelta(minutes=settings.voice_token_minutes),
        "video": {
            "room": room,
            "roomJoin": True,
            "canPublish": True,
            "canSubscribe": True,
            "canPublishData": True,
        },
    }
    return jwt.encode(claims, settings.livekit_api_secret, algorithm="HS256")


def _server_key(server_id: uuid.UUID) -> str:
    return f"{get_settings().redis_prefix}:voice:server:{server_id}"


def _user_key(user_id: uuid.UUID) -> str:
    return f"{get_settings().redis_prefix}:voice:user:{user_id}"


async def get_states(server_id: uuid.UUID) -> list[VoiceState]:
    raw = await broker.redis.hgetall(_server_key(server_id))
    return [VoiceState.model_validate_json(v) for v in raw.values()]


async def _announce(
    server_id: uuid.UUID, user_id: uuid.UUID, state: VoiceState | None, recipients: list[uuid.UUID]
) -> None:
    data = {
        "server_id": str(server_id),
        "user_id": str(user_id),
        "state": state.model_dump(mode="json") if state else None,
    }
    await broker.publish("voice.state", data, recipients)


async def _remove(user_id: uuid.UUID, server_id: uuid.UUID, recipients: list[uuid.UUID]) -> None:
    await broker.redis.hdel(_server_key(server_id), str(user_id))
    await _announce(server_id, user_id, None, recipients)


async def set_state(state: VoiceState, server_id: uuid.UUID, recipients_for: RecipientsFor) -> None:
    """Puts the user in a voice channel, leaving any channel they were in on another server."""
    redis = broker.redis
    previous = await redis.get(_user_key(state.user_id))
    if previous and previous != str(server_id):
        previous_id = uuid.UUID(previous)
        await _remove(state.user_id, previous_id, await recipients_for(previous_id))
    await redis.hset(_server_key(server_id), str(state.user_id), state.model_dump_json())
    await redis.set(_user_key(state.user_id), str(server_id))
    await _announce(server_id, state.user_id, state, await recipients_for(server_id))


async def leave(user_id: uuid.UUID, recipients_for: RecipientsFor) -> None:
    """Removes the user from whatever voice channel they're in, if any."""
    current = await broker.redis.getdel(_user_key(user_id))
    if current:
        server_id = uuid.UUID(current)
        await _remove(user_id, server_id, await recipients_for(server_id))


async def leave_server(user_id: uuid.UUID, server_id: uuid.UUID, recipients: list[uuid.UUID]) -> None:
    """Removes the user from voice in this server only (e.g. they left the server)."""
    if await broker.redis.hexists(_server_key(server_id), str(user_id)):
        await broker.redis.delete(_user_key(user_id))
        await _remove(user_id, server_id, recipients)


async def clear_channel(server_id: uuid.UUID, channel_id: uuid.UUID, recipients: list[uuid.UUID]) -> None:
    for state in await get_states(server_id):
        if state.channel_id == channel_id:
            await leave_server(state.user_id, server_id, recipients)


async def clear_server(server_id: uuid.UUID) -> None:
    """Drops all voice state of a deleted server (its members get server.deleted instead)."""
    for state in await get_states(server_id):
        await broker.redis.delete(_user_key(state.user_id))
    await broker.redis.delete(_server_key(server_id))
