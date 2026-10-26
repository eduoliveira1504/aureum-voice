"""Painel de sons: each server's short sounds, played in its voice rooms (block 3.15).

A sound is an mp3, ogg (Vorbis or Opus) or wav of up to MAX_BYTES, recognized by its bytes and
kept as uploaded. Its length is measured here (tinytag) and must be at most MAX_SECONDS; the app
that plays it stops at that length too, so a file whose header lies doesn't play longer.
Files are served by /api/media/sounds/{id}, to the server's members only. A sound belongs to its
server: it can't be played anywhere else, DMs included.

Playing (see docs/decisions/0035-soundboard.md): the app asks POST /sounds/{id}/play first, then
publishes the sound itself as a second LiveKit audio track named "soundboard". The API checks that
the user is in one of that server's voice rooms with SPEAK and USE_SOUNDBOARD, not deafened and
not server-muted, and holds a per-user lock in Redis for the sound's length (at least COOLDOWN_MS):
one sound at a time, and a 3 s cooldown.
"""

import io
import uuid

from anyio import to_thread
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from tinytag import TinyTag

from app import storage, voice
from app.config import get_settings
from app.models import Channel, ServerMember, SoundboardSound
from app.permissions import Perm, server_access
from app.realtime import broker

MAX_BYTES = 1024 * 1024
MAX_SECONDS = 5.0
# Encoders pad the end (an mp3 of exactly 5 s measures ~5.07 s); not enough to matter.
SLACK_SECONDS = 0.2
MAX_PER_SERVER = 24
COOLDOWN_MS = 3000
URL_PREFIX = storage.MEDIA_PREFIX + "sounds/"
# Stored files; not under /api/media's public prefixes.
KEY_PREFIX = "sounds/"


def url_of(sound: SoundboardSound) -> str:
    return f"{URL_PREFIX}{sound.id}"


def sniff_audio(data: bytes) -> tuple[str, str] | None:
    """(content type, extension) for mp3 (ID3 tag or a frame sync), ogg and wav."""
    if data[:3] == b"ID3" or (len(data) > 1 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0):
        return "audio/mpeg", "mp3"
    if data[:4] == b"OggS":
        return "audio/ogg", "ogg"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "audio/wav", "wav"
    return None


def _duration(data: bytes) -> float | None:
    try:
        return TinyTag.get(file_obj=io.BytesIO(data)).duration
    except Exception:  # uploads are untrusted: a parser error just means "not audio"
        return None


async def check_audio(data: bytes) -> tuple[str, str, int]:
    """Returns (content type, extension, duration in ms), or raises 413/415/422."""
    if len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Sounds must be at most 1 MB")
    detected = sniff_audio(data)
    if detected is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Use MP3, OGG or WAV")
    seconds = await to_thread.run_sync(_duration, data)
    if not seconds or seconds <= 0:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Use MP3, OGG or WAV")
    if seconds > MAX_SECONDS + SLACK_SECONDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Sounds must be at most 5 seconds long")
    return detected[0], detected[1], min(round(seconds * 1000), int(MAX_SECONDS * 1000))


async def add(
    session: AsyncSession, server_id: uuid.UUID, data: bytes, name: str, emoji: str | None, volume: int, by: uuid.UUID
) -> SoundboardSound:
    """Checks and stores a sound at the end of the server's list. Not committed."""
    count = await session.scalar(select(func.count()).select_from(SoundboardSound).where(SoundboardSound.server_id == server_id))
    if (count or 0) >= MAX_PER_SERVER:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"A server can have up to {MAX_PER_SERVER} sounds")
    content_type, ext, duration_ms = await check_audio(data)
    key = f"{KEY_PREFIX}{server_id}/{uuid.uuid4().hex}.{ext}"
    await storage.put(key, data, content_type)
    last = await session.scalar(select(func.max(SoundboardSound.position)).where(SoundboardSound.server_id == server_id))
    sound = SoundboardSound(
        id=uuid.uuid4(), server_id=server_id, name=name, emoji=emoji, volume=volume, duration_ms=duration_ms,
        key=key, content_type=content_type, position=(last or 0) + 1, created_by=by,
    )
    session.add(sound)
    return sound


async def of_server(session: AsyncSession, server_id: uuid.UUID) -> list[SoundboardSound]:
    return list(
        await session.scalars(
            select(SoundboardSound)
            .where(SoundboardSound.server_id == server_id)
            .order_by(SoundboardSound.position, SoundboardSound.created_at)
        )
    )


async def visible(session: AsyncSession, sound_id: uuid.UUID, user_id: uuid.UUID) -> SoundboardSound:
    """The sound, if the user is a member of its server; 404 otherwise."""
    sound = await session.get(SoundboardSound, sound_id)
    if sound is None or await session.get(ServerMember, (sound.server_id, user_id)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Sound not found")
    return sound


def _lock_key(user_id: uuid.UUID) -> str:
    return f"{get_settings().redis_prefix}:soundboard:{user_id}"


async def start_playing(session: AsyncSession, sound: SoundboardSound, user_id: uuid.UUID) -> None:
    """Lets the user play `sound` now in the room they're in, or raises (403, 409 or 429)."""
    current = await voice.current_state(user_id)
    if current is None or current[0] != voice.server_scope(sound.server_id):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Join one of this server's voice rooms first")
    state = current[1]
    channel = await session.get(Channel, state.channel_id)
    member = await session.get(ServerMember, (sound.server_id, user_id))
    if channel is None or member is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Join one of this server's voice rooms first")
    access = await server_access(session, sound.server_id, user_id)
    access.require_in(channel, Perm.SPEAK)
    access.require_in(channel, Perm.USE_SOUNDBOARD)
    if state.deafened or member.voice_deafened:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Sounds are off while you're deafened")
    if state.server_muted or member.voice_muted:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You were muted in this server")
    hold = max(sound.duration_ms, COOLDOWN_MS)
    if not await broker.redis.set(_lock_key(user_id), str(sound.id), px=hold, nx=True):
        left = await broker.redis.pttl(_lock_key(user_id))
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Wait for your last sound",
            headers={"Retry-After": str(max(1, -(-max(left, 0) // 1000)))},
        )
