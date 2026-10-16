"""Voice: LiveKit access tokens and who-is-in-which-voice-channel state.

Clients report their own voice state (channel, mute, deafen, camera, screen) over the
WebSocket; it's stored in Redis per server and broadcast as `voice.state` events. A user
is in at most one voice channel, and drops out when their last connection closes.

Screen-share thumbnails: whoever is sharing sends a small JPEG every few seconds. Only the
latest one per user is kept, in Redis with a short TTL (never in the database), and it goes
only to connections watching that server's overview. It's dropped when the share ends.
"""

import base64
import binascii
import json
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

import jwt
from pydantic import BaseModel

from app.config import get_settings
from app.realtime import broker

# Returns who should be told about voice changes in a server (its members).
RecipientsFor = Callable[[uuid.UUID], Awaitable[list[uuid.UUID]]]


THUMBNAIL_TTL_SECONDS = 20  # a bit over the client's 5-10s cadence
THUMBNAIL_MIN_INTERVAL_MS = 4000
THUMBNAIL_PREFIX = "data:image/jpeg;base64,"
MAX_THUMBNAIL_CHARS = 64_000  # a 320x180 JPEG at quality ~0.6 is ~10-20 KB


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


def _thumbnail_key(server_id: uuid.UUID, user_id: uuid.UUID) -> str:
    return f"{get_settings().redis_prefix}:voice:thumb:{server_id}:{user_id}"


async def current_state(user_id: uuid.UUID) -> tuple[uuid.UUID, VoiceState] | None:
    """(server id, state) of the voice channel the user is in, if any."""
    server_id = await broker.redis.get(_user_key(user_id))
    if not server_id:
        return None
    raw = await broker.redis.hget(_server_key(uuid.UUID(server_id)), str(user_id))
    return (uuid.UUID(server_id), VoiceState.model_validate_json(raw)) if raw else None


def valid_thumbnail(image: object) -> bool:
    if not isinstance(image, str) or not image.startswith(THUMBNAIL_PREFIX) or len(image) > MAX_THUMBNAIL_CHARS:
        return False
    try:
        data = base64.b64decode(image[len(THUMBNAIL_PREFIX) :], validate=True)
    except (binascii.Error, ValueError):
        return False
    return data.startswith(b"\xff\xd8")  # JPEG magic


def _thumbnail_event(server_id: uuid.UUID, user_id: uuid.UUID, channel_id: uuid.UUID | None, image: str | None) -> dict[str, str | None]:
    return {
        "server_id": str(server_id),
        "user_id": str(user_id),
        "channel_id": str(channel_id) if channel_id else None,
        "image": image,
    }


async def store_thumbnail(user_id: uuid.UUID, image: str) -> bool:
    """Keeps and forwards a thumbnail if the user is sharing their screen right now.
    Returns False when it was refused (not sharing, or sent too soon after the last one)."""
    current = await current_state(user_id)
    if current is None or not current[1].screen:
        return False
    server_id, state = current
    throttle = f"{get_settings().redis_prefix}:voice:thumb-rl:{user_id}"
    if not await broker.redis.set(throttle, "1", px=THUMBNAIL_MIN_INTERVAL_MS, nx=True):
        return False
    value = json.dumps({"channel_id": str(state.channel_id), "image": image})
    await broker.redis.set(_thumbnail_key(server_id, user_id), value, ex=THUMBNAIL_TTL_SECONDS)
    await broker.publish_to_watchers(
        "screen.thumbnail", _thumbnail_event(server_id, user_id, state.channel_id, image), server_id
    )
    return True


async def clear_thumbnail(server_id: uuid.UUID, user_id: uuid.UUID) -> None:
    if await broker.redis.delete(_thumbnail_key(server_id, user_id)):
        await broker.publish_to_watchers("screen.thumbnail", _thumbnail_event(server_id, user_id, None, None), server_id)


async def get_thumbnails(server_id: uuid.UUID) -> list[dict[str, str | None]]:
    """Latest thumbnails of a server, as screen.thumbnail event payloads."""
    prefix = _thumbnail_key(server_id, uuid.UUID(int=0))[: -len(str(uuid.UUID(int=0)))]
    events = []
    async for key in broker.redis.scan_iter(match=f"{prefix}*"):
        raw = await broker.redis.get(key)
        if raw:
            value = json.loads(raw)
            user_id = uuid.UUID(key[len(prefix) :])
            events.append(_thumbnail_event(server_id, user_id, uuid.UUID(value["channel_id"]), value["image"]))
    return events


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
    await clear_thumbnail(server_id, user_id)
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
    if not state.screen:
        await clear_thumbnail(server_id, state.user_id)
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
        await broker.redis.delete(_user_key(state.user_id), _thumbnail_key(server_id, state.user_id))
    await broker.redis.delete(_server_key(server_id))
