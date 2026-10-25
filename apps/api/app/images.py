"""Uploaded images (avatars, banners, server icons, role icons): validated by their bytes,
stored on MinIO under a fresh key, and the old file removed once the new one is saved.

Avatars, profile banners and server icons/banners can come with a crop from the app's editor
(ImageCrop): the API crops the original (app/cropping.py) and keeps it under originals/, which
/api/media never serves, so the owner can re-crop later without uploading it again. The model
keeps `{kind}_url` (what everyone sees) and `{kind}_source` ({"key", "crop"}; null without a crop).
"""

import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from anyio import to_thread
from fastapi import HTTPException, Response, UploadFile, status

from app import cropping, storage
from app.schemas import ImageCrop

MAX_IMAGE_BYTES = 8 * 1024 * 1024
# Key prefixes served by /api/media.
PUBLIC_PREFIXES = ("avatars/", "banners/", "servers/", "roles/", "groups/")
# Cropped originals; private (see original()).
ORIGINALS = "originals/"
# The largest a cropped image is kept (scaled down to fit, never up), by kind.
MAX_OUTPUT = {"avatar": (512, 512), "icon": (512, 512), "banner": (1600, 800)}

Save = Callable[[], Awaitable[None]]


async def _read(upload: UploadFile) -> tuple[bytes, str, str]:
    """The upload's bytes, content type and extension, after checking its size and type."""
    data = await upload.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image must be at most 8 MB")
    detected = storage.sniff_image(data)
    if detected is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Use PNG, JPG, GIF or WebP")
    return data, *detected


async def store_upload(upload: UploadFile, prefix: str) -> str:
    """Stores a PNG/JPG/GIF/WebP (animated allowed, up to 8 MB) and returns its media URL."""
    data, content_type, ext = await _read(upload)
    key = f"{prefix}/{uuid.uuid4().hex}.{ext}"
    await storage.put(key, data, content_type)
    return storage.url_for(key)


async def _store_cropped(data: bytes, prefix: str, crop: ImageCrop, kind: str) -> str:
    """Stores the cropped image and returns its key."""
    try:
        out = await to_thread.run_sync(cropping.crop, data, crop, MAX_OUTPUT[kind])
    except cropping.CropError as err:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Could not crop the image") from err
    if len(out.data) > MAX_IMAGE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image must be at most 8 MB")
    key = f"{prefix}/{uuid.uuid4().hex}.{out.ext}"
    await storage.put(key, out.data, out.content_type)
    return key


def _keys(url: str | None, source: dict[str, Any] | None) -> set[str]:
    keys = {source["key"]} if source else set()
    if key := storage.key_from_url(url):
        keys.add(key)
    return keys


async def _swap(target: Any, kind: str, url: str | None, source: dict[str, Any] | None, save: Save) -> None:
    """Points the model at the new image and commits (`save`), then deletes the files only the
    old one used. If saving fails, the files only the new one used are deleted instead."""
    old = _keys(getattr(target, f"{kind}_url"), getattr(target, f"{kind}_source", None))
    new = _keys(url, source)
    setattr(target, f"{kind}_url", url)
    if hasattr(target, f"{kind}_source"):
        setattr(target, f"{kind}_source", source)
    try:
        await save()
    except BaseException:
        for key in new - old:
            await storage.delete(key)
        raise
    for key in old - new:
        await storage.delete(key)


async def replace(old_url: str | None, new_url: str | None, save: Save) -> None:
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


async def set_image(target: Any, kind: str, upload: UploadFile | None, crop: ImageCrop | None, prefix: str, save: Save) -> None:
    """Replaces `target.{kind}_url` with the upload (cropped when `crop` is given, keeping the
    original), or with no upload removes it, original included."""
    if upload is None:
        return await _swap(target, kind, None, None, save)
    if crop is None:  # as before the crop editor (older apps)
        return await _swap(target, kind, await store_upload(upload, prefix), None, save)
    data, content_type, ext = await _read(upload)
    key = await _store_cropped(data, prefix, crop, kind)
    original = f"{ORIGINALS}{prefix}/{uuid.uuid4().hex}.{ext}"
    try:
        await storage.put(original, data, content_type)
    except BaseException:
        await storage.delete(key)
        raise
    await _swap(target, kind, storage.url_for(key), {"key": original, "crop": crop.model_dump()}, save)


async def set_crop(target: Any, kind: str, crop: ImageCrop, prefix: str, save: Save) -> None:
    """Crops the kept original again ("Ajustar posição")."""
    source = getattr(target, f"{kind}_source")
    stored = await storage.get(source["key"]) if source else None
    if stored is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This image has no original to crop again")
    key = await _store_cropped(stored.data, prefix, crop, kind)
    await _swap(target, kind, storage.url_for(key), {**source, "crop": crop.model_dump()}, save)


async def original(target: Any, kind: str) -> Response:
    """The kept original, for the crop editor. Callers check who may see it."""
    source = getattr(target, f"{kind}_source")
    stored = await storage.get(source["key"]) if source else None
    if stored is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return Response(stored.data, media_type=stored.content_type, headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


def crop_field(raw: str | None) -> ImageCrop | None:
    """The crop sent next to an upload as a JSON form field."""
    if raw is None:
        return None
    try:
        return ImageCrop.model_validate_json(raw)
    except ValueError as err:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid crop") from err
