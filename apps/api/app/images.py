"""Uploaded images (avatars, banners, server icons, role icons): validated by their bytes,
stored on MinIO under a fresh key, and the old file removed once the new one is saved."""

import uuid
from collections.abc import Awaitable, Callable

from fastapi import HTTPException, UploadFile, status

from app import storage

MAX_IMAGE_BYTES = 8 * 1024 * 1024
# Key prefixes served by /api/media.
PUBLIC_PREFIXES = ("avatars/", "banners/", "servers/", "roles/")


async def store_upload(upload: UploadFile, prefix: str) -> str:
    """Stores a PNG/JPG/GIF/WebP (animated allowed, up to 8 MB) and returns its media URL."""
    data = await upload.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image must be at most 8 MB")
    detected = storage.sniff_image(data)
    if detected is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Use PNG, JPG, GIF or WebP")
    content_type, ext = detected
    key = f"{prefix}/{uuid.uuid4().hex}.{ext}"
    await storage.put(key, data, content_type)
    return storage.url_for(key)


async def replace(old_url: str | None, new_url: str | None, save: Callable[[], Awaitable[None]]) -> None:
    """Commits the new URL (`save`), then deletes the old file. If saving fails, the new file
    is deleted instead, so nothing is left behind."""
    try:
        await save()
    except BaseException:
        if key := storage.key_from_url(new_url):
            await storage.delete(key)
        raise
    if key := storage.key_from_url(old_url):
        await storage.delete(key)
