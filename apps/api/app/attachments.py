"""Files sent in conversations (server text channels, DMs and groups).

A file is uploaded on its own first (so the app can show progress), then attached by the
message that sends it. Downloads go through /api/media/attachments/{id}, which checks the
caller can see the channel: unlike avatars, these are never public. See
docs/decisions/0015-attachments-and-background.md.
"""

import io
import re
import unicodedata
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException, UploadFile, status
from PIL import Image, UnidentifiedImageError
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import storage
from app.config import get_settings
from app.models import Attachment, AttachmentKind, Channel, Message

MAX_PER_MESSAGE = 10
# Uploads not sent within this time are dropped (the next upload by the same person cleans them).
PENDING_TTL = timedelta(hours=24)
MAX_PENDING = 50
# Voice messages: up to 5 minutes (a little slack for the recorder's last chunk), drawn with up
# to 128 bars of 0-100.
MAX_VOICE_MS = 5 * 60 * 1000
VOICE_SLACK_MS = 2000
MAX_WAVEFORM = 128
URL_PREFIX = storage.MEDIA_PREFIX + "attachments/"

_UNSAFE = re.compile(r'[\x00-\x1f\x7f<>:"/\\|?*]')


def max_bytes() -> int:
    return get_settings().max_attachment_mb * 1024 * 1024


def clean_filename(name: str | None) -> str:
    """The file's own name, without folders or characters Windows can't save."""
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    base = _UNSAFE.sub("_", unicodedata.normalize("NFC", base)).strip(" .")
    if len(base) > 200:
        stem, dot, ext = base.rpartition(".")
        base = (stem[: 200 - len(ext) - 1] + "." + ext) if dot and len(ext) <= 16 else base[:200]
    return base or "arquivo"


def sniff(data: bytes) -> tuple[AttachmentKind, str]:
    """(kind, content type) from the bytes. Only images and videos the app plays are shown
    inline; anything else is served as a plain download, whatever the client claimed."""
    image = storage.sniff_image(data)
    if image:
        return AttachmentKind.image, image[0]
    if data[:4] == b"\x1aE\xdf\xa3":
        return AttachmentKind.video, "video/webm"
    if data[4:8] == b"ftyp":
        brand = data[8:12]
        if brand == b"qt  ":
            return AttachmentKind.video, "video/quicktime"
        if not brand.startswith((b"M4A", b"M4B", b"M4P")):  # those are audio
            return AttachmentKind.video, "video/mp4"
    return AttachmentKind.file, "application/octet-stream"


# EXIF orientations that turn the picture a quarter: the app shows it with width and height swapped.
_QUARTER_TURNS = {5, 6, 7, 8}


def image_size(data: bytes) -> dict[str, int] | None:
    """{"width", "height"} as the app shows the image (after its EXIF turn), so it can save the
    room before the image loads. Only reads the header; None when Pillow can't tell."""
    try:
        with Image.open(io.BytesIO(data)) as im:
            width, height = im.size
            if im.getexif().get(0x0112) in _QUARTER_TURNS:
                width, height = height, width
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, ValueError):
        return None
    return {"width": width, "height": height} if width > 0 and height > 0 else None


def voice_meta(duration_ms: int | None, waveform: str | None) -> dict[str, Any]:
    """Checks what the app measured while recording a voice message. The waveform comes as
    comma-separated bar heights (0-100)."""
    if duration_ms is None or not 0 < duration_ms <= MAX_VOICE_MS + VOICE_SLACK_MS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Voice messages last up to 5 minutes")
    try:
        bars = [int(v) for v in (waveform or "").split(",") if v.strip()]
    except ValueError:
        bars = []
    if not 0 < len(bars) <= MAX_WAVEFORM or any(not 0 <= b <= 100 for b in bars):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid waveform")
    return {"duration_ms": min(duration_ms, MAX_VOICE_MS), "waveform": bars}


def out(attachment: Attachment) -> dict[str, Any]:
    """The public fields, as messages carry them."""
    fields: dict[str, Any] = {
        "id": str(attachment.id),
        "filename": attachment.filename,
        "kind": attachment.kind.value,
        "content_type": attachment.content_type,
        "size": attachment.size,
        "url": f"{URL_PREFIX}{attachment.id}",
    }
    if attachment.kind == AttachmentKind.voice and attachment.meta:
        fields["duration_ms"] = attachment.meta["duration_ms"]
        fields["waveform"] = attachment.meta["waveform"]
    if attachment.kind == AttachmentKind.image and attachment.meta:
        fields["width"] = attachment.meta["width"]
        fields["height"] = attachment.meta["height"]
    return fields


async def _drop_stale(session: AsyncSession, user_id: uuid.UUID) -> None:
    cutoff = datetime.now(UTC) - PENDING_TTL
    stale = list(
        await session.scalars(
            delete(Attachment)
            .where(Attachment.uploader_id == user_id, Attachment.message_id.is_(None), Attachment.created_at < cutoff)
            .returning(Attachment.key)
        )
    )
    await session.commit()
    await delete_keys(stale)


async def upload(
    session: AsyncSession, channel: Channel, user_id: uuid.UUID, file: UploadFile, voice: dict[str, Any] | None = None
) -> Attachment:
    """Stores a file for a message the user is about to send in the channel. Commits. With
    `voice` (see voice_meta) it's a voice message, which must be a WebM recording."""
    await _drop_stale(session, user_id)
    pending = await session.scalar(
        select(func.count()).where(Attachment.uploader_id == user_id, Attachment.message_id.is_(None))
    )
    if (pending or 0) >= MAX_PENDING:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many files waiting to be sent")
    limit = max_bytes()
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=f"Files must be at most {get_settings().max_attachment_mb} MB"
        )
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The file is empty")
    kind, content_type = sniff(data)
    filename = clean_filename(file.filename)
    if voice is not None:
        if content_type != "video/webm":  # any WebM: what the app's recorder makes
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Voice messages must be Opus/WebM")
        kind, content_type, filename = AttachmentKind.voice, "audio/webm", "mensagem-de-voz.webm"
    meta = voice if voice is not None else image_size(data) if kind == AttachmentKind.image else None
    attachment = Attachment(
        id=uuid.uuid4(),
        channel_id=channel.id,
        uploader_id=user_id,
        filename=filename,
        kind=kind,
        content_type=content_type,
        size=len(data),
        meta=meta,
    )
    attachment.key = f"attachments/{channel.id}/{attachment.id}"
    await storage.put(attachment.key, data, content_type)
    session.add(attachment)
    try:
        await session.commit()
    except BaseException:
        await storage.delete(attachment.key)
        raise
    return attachment


async def attach(session: AsyncSession, message: Message, ids: list[uuid.UUID], user_id: uuid.UUID) -> None:
    """Gives the message the user's pending uploads in its channel (in the order given).
    The message must be flushed; not committed."""
    if not ids:
        return
    wanted = list(dict.fromkeys(ids))
    found = {
        a.id: a
        for a in await session.scalars(
            select(Attachment).where(
                Attachment.id.in_(wanted),
                Attachment.uploader_id == user_id,
                Attachment.channel_id == message.channel_id,
                Attachment.message_id.is_(None),
            )
        )
    }
    if len(found) != len(wanted):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown or already sent attachment")
    for attachment in found.values():
        attachment.message_id = message.id
    message.attachments = [out(found[i]) for i in wanted]


async def keys_of_messages(session: AsyncSession, message_ids: Iterable[int]) -> list[str]:
    ids = list(message_ids)
    if not ids:
        return []
    return list(await session.scalars(select(Attachment.key).where(Attachment.message_id.in_(ids))))


async def keys_of_channels(session: AsyncSession, channel_ids: Iterable[uuid.UUID]) -> list[str]:
    """Every stored file of these channels (sent or pending), to delete once they're gone."""
    ids = list(channel_ids)
    if not ids:
        return []
    return list(await session.scalars(select(Attachment.key).where(Attachment.channel_id.in_(ids))))


async def delete_keys(keys: Iterable[str]) -> None:
    for key in keys:
        await storage.delete(key)
