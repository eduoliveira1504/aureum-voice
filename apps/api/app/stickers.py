"""Stickers: Aureum's packs, which work everywhere, and each server's own, which work only there.

Only static images for now. An upload (PNG or WebP, up to MAX_BYTES) is checked by its bytes,
scaled down to fit MAX_SIDE and kept as a WebP, so what's stored is always a plain still image.
Files are served by /api/media/stickers/{id}: global ones to anyone signed in, a server's to its
members. Global packs come from the CLI (`stickers pack-add` / `sticker-add`), never the API.

A sticker message keeps a snapshot of the sticker (`messages.sticker`), so it still says what it
was after the sticker is removed (the app then shows that it's gone). Sending one needs
USE_STICKERS in servers; a server's sticker can only be sent (or forwarded) inside that server.
"""

import io
import uuid
from typing import Any

from anyio import to_thread
from fastapi import HTTPException, status
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import storage
from app.models import Channel, ServerMember, Sticker, StickerPack
from app.permissions import Perm, ServerAccess

MAX_BYTES = 512 * 1024
MAX_SIDE = 320
MAX_PER_SERVER = 30
URL_PREFIX = storage.MEDIA_PREFIX + "stickers/"
# Stored files; not under /api/media's public prefixes.
KEY_PREFIX = "stickers/"


def url_of(sticker: Sticker) -> str:
    return f"{URL_PREFIX}{sticker.id}"


def _to_webp(data: bytes) -> tuple[bytes, int, int]:
    with Image.open(io.BytesIO(data)) as image:
        if getattr(image, "n_frames", 1) > 1:
            raise ValueError("animated")
        image.load()
        frame = image.convert("RGBA")
        frame.thumbnail((MAX_SIDE, MAX_SIDE))
        out = io.BytesIO()
        frame.save(out, "WEBP", quality=90)
        return out.getvalue(), frame.width, frame.height


async def store_image(data: bytes) -> tuple[str, int, int]:
    """Checks and stores a sticker's image. Returns (key, width, height)."""
    if len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Stickers must be at most 512 KB")
    detected = storage.sniff_image(data)
    if detected is None or detected[0] not in ("image/png", "image/webp"):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Use PNG or WebP")
    try:
        webp, width, height = await to_thread.run_sync(_to_webp, data)
    except ValueError as exc:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Animated stickers aren't supported yet") from exc
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Use PNG or WebP") from exc
    key = f"{KEY_PREFIX}{uuid.uuid4().hex}.webp"
    await storage.put(key, webp, "image/webp")
    return key, width, height


async def add(
    session: AsyncSession, pack: StickerPack, data: bytes, name: str, emoji: str | None, by: uuid.UUID | None
) -> Sticker:
    """Adds a sticker at the end of the pack. Not committed."""
    key, width, height = await store_image(data)
    last = await session.scalar(select(func.max(Sticker.position)).where(Sticker.pack_id == pack.id))
    sticker = Sticker(
        id=uuid.uuid4(), pack_id=pack.id, name=name, emoji=emoji, key=key, width=width, height=height,
        position=(last or 0) + 1, created_by=by,
    )
    session.add(sticker)
    return sticker


async def server_pack(session: AsyncSession, server_id: uuid.UUID, *, create: bool = False) -> StickerPack | None:
    pack = await session.scalar(select(StickerPack).where(StickerPack.server_id == server_id))
    if pack is None and create:
        pack = StickerPack(id=uuid.uuid4(), name="", server_id=server_id)
        session.add(pack)
        await session.flush()
    return pack


async def visible_packs(session: AsyncSession, user_id: uuid.UUID) -> list[StickerPack]:
    """Aureum's packs first, then those of the user's servers."""
    mine = select(ServerMember.server_id).where(ServerMember.user_id == user_id)
    packs = await session.scalars(
        select(StickerPack)
        .where(StickerPack.is_global.is_(True) | StickerPack.server_id.in_(mine))
        .order_by(StickerPack.is_global.desc(), StickerPack.position, StickerPack.created_at)
    )
    return [p for p in packs if p.is_global or p.stickers]


async def can_see(session: AsyncSession, sticker: Sticker, user_id: uuid.UUID) -> bool:
    pack = sticker.pack
    if pack.is_global:
        return True
    assert pack.server_id is not None
    return await session.get(ServerMember, (pack.server_id, user_id)) is not None


def snapshot(sticker: Sticker) -> dict[str, Any]:
    return {
        "id": str(sticker.id),
        "name": sticker.name,
        "pack_id": str(sticker.pack_id),
        "server_id": str(sticker.pack.server_id) if sticker.pack.server_id else None,
        "url": url_of(sticker),
        "width": sticker.width,
        "height": sticker.height,
    }


def fallback(name: str) -> str:
    """What apps that don't know stickers show instead."""
    return f"[Figurinha: {name}]"


def require_here(sticker: dict[str, Any], channel: Channel, access: ServerAccess | None) -> None:
    """A sticker (as a message keeps it) may be sent in `channel`: a server's only in that server,
    and in servers only with USE_STICKERS."""
    if sticker.get("server_id") and sticker["server_id"] != (str(channel.server_id) if channel.server_id else None):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="This sticker can only be sent in its server")
    if access is not None:
        access.require_in(channel, Perm.USE_STICKERS)


async def for_sending(session: AsyncSession, sticker_id: uuid.UUID, user_id: uuid.UUID) -> Sticker:
    sticker = await session.get(Sticker, sticker_id)
    if sticker is None or not await can_see(session, sticker, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Sticker not found")
    return sticker
