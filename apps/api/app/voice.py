"""Voice: LiveKit access tokens and who-is-in-which-voice-channel state.

Clients report their own voice state (channel, mute, deafen, camera, screen) over the
WebSocket; it's stored in Redis per scope and broadcast as `voice.state` events. A scope is a
server (its voice channels) or a DM/group (its private call). A user is in at most one voice
channel, and drops out when their last connection closes.

Screen-share thumbnails: whoever is sharing sends a small JPEG every few seconds. Only the
latest one per user is kept, in Redis with a short TTL (never in the database), and it goes
only to connections watching that server's overview. It's dropped when the share ends.
"""

import base64
import binascii
import json
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

import jwt
from pydantic import BaseModel

from app.config import get_settings
from app.realtime import broker


@dataclass(frozen=True)
class Scope:
    """Where a voice channel lives: a server, or a DM/group (then id is that channel's id)."""

    kind: Literal["server", "dm"]
    id: uuid.UUID

    def __str__(self) -> str:
        return f"{self.kind}:{self.id}"

    @classmethod
    def parse(cls, raw: str) -> "Scope":
        kind, _, id_ = raw.rpartition(":")
        return cls("dm" if kind == "dm" else "server", uuid.UUID(id_))


def server_scope(server_id: uuid.UUID) -> Scope:
    return Scope("server", server_id)


def dm_scope(channel_id: uuid.UUID) -> Scope:
    return Scope("dm", channel_id)


# Returns who should be told about voice changes in a scope (its members).
RecipientsFor = Callable[[Scope], Awaitable[list[uuid.UUID]]]
# Called after someone leaves a scope, with how many people are still in it.
LeftHandler = Callable[[Scope, uuid.UUID, int], Awaitable[None]]
_left_handlers: list[LeftHandler] = []


def on_left(handler: LeftHandler) -> None:
    _left_handlers.append(handler)


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


def _scope_key(scope: Scope) -> str:
    return f"{get_settings().redis_prefix}:voice:{scope.kind}:{scope.id}"


def _user_key(user_id: uuid.UUID) -> str:
    return f"{get_settings().redis_prefix}:voice:user:{user_id}"


def _thumbnail_key(server_id: uuid.UUID, user_id: uuid.UUID) -> str:
    return f"{get_settings().redis_prefix}:voice:thumb:{server_id}:{user_id}"


async def current_state(user_id: uuid.UUID) -> tuple[Scope, VoiceState] | None:
    """(scope, state) of the voice channel the user is in, if any."""
    raw_scope = await broker.redis.get(_user_key(user_id))
    if not raw_scope:
        return None
    scope = Scope.parse(raw_scope)
    raw = await broker.redis.hget(_scope_key(scope), str(user_id))
    return (scope, VoiceState.model_validate_json(raw)) if raw else None


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
    # Only server overviews show thumbnails; nobody outside a private call would see them.
    if current is None or not current[1].screen or current[0].kind != "server":
        return False
    server_id, state = current[0].id, current[1]
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


async def get_states(scope: Scope) -> list[VoiceState]:
    raw = await broker.redis.hgetall(_scope_key(scope))
    return [VoiceState.model_validate_json(v) for v in raw.values()]


async def _announce(scope: Scope, user_id: uuid.UUID, state: VoiceState | None, recipients: list[uuid.UUID]) -> None:
    data = {
        "server_id": str(scope.id) if scope.kind == "server" else None,
        "dm_id": str(scope.id) if scope.kind == "dm" else None,
        "user_id": str(user_id),
        "state": state.model_dump(mode="json") if state else None,
    }
    await broker.publish("voice.state", data, recipients)


async def _remove(user_id: uuid.UUID, scope: Scope, recipients: list[uuid.UUID]) -> None:
    key = _scope_key(scope)
    await broker.redis.hdel(key, str(user_id))
    if scope.kind == "server":
        await clear_thumbnail(scope.id, user_id)
    await _announce(scope, user_id, None, recipients)
    remaining = await broker.redis.hlen(key)
    for handler in _left_handlers:
        await handler(scope, user_id, remaining)


async def set_state(state: VoiceState, scope: Scope, recipients_for: RecipientsFor) -> None:
    """Puts the user in a voice channel, leaving any channel they were in elsewhere."""
    redis = broker.redis
    previous = await redis.get(_user_key(state.user_id))
    if previous and Scope.parse(previous) != scope:
        previous_scope = Scope.parse(previous)
        await _remove(state.user_id, previous_scope, await recipients_for(previous_scope))
    await redis.hset(_scope_key(scope), str(state.user_id), state.model_dump_json())
    await redis.set(_user_key(state.user_id), str(scope))
    if scope.kind == "server" and not state.screen:
        await clear_thumbnail(scope.id, state.user_id)
    await _announce(scope, state.user_id, state, await recipients_for(scope))


async def leave(user_id: uuid.UUID, recipients_for: RecipientsFor) -> None:
    """Removes the user from whatever voice channel they're in, if any."""
    current = await broker.redis.getdel(_user_key(user_id))
    if current:
        scope = Scope.parse(current)
        await _remove(user_id, scope, await recipients_for(scope))


async def leave_scope(user_id: uuid.UUID, scope: Scope, recipients: list[uuid.UUID]) -> None:
    """Removes the user from voice in this scope only (e.g. they left the server or group)."""
    if await broker.redis.hexists(_scope_key(scope), str(user_id)):
        await broker.redis.delete(_user_key(user_id))
        await _remove(user_id, scope, recipients)


async def clear_channel(server_id: uuid.UUID, channel_id: uuid.UUID, recipients: list[uuid.UUID]) -> None:
    scope = server_scope(server_id)
    for state in await get_states(scope):
        if state.channel_id == channel_id:
            await leave_scope(state.user_id, scope, recipients)


async def clear_server(server_id: uuid.UUID) -> None:
    """Drops all voice state of a deleted server (its members get server.deleted instead)."""
    scope = server_scope(server_id)
    for state in await get_states(scope):
        await broker.redis.delete(_user_key(state.user_id), _thumbnail_key(server_id, state.user_id))
    await broker.redis.delete(_scope_key(scope))
