"""File storage on MinIO (S3-compatible) for avatars, banners and, later, attachments.

The bucket is private; files are served by the API at /api/media/{key}. Object keys are
unique per upload, so responses can be cached forever.
"""

import io
from dataclasses import dataclass
from functools import lru_cache

from anyio import to_thread
from minio import Minio
from minio.error import S3Error

from app.config import get_settings

MEDIA_PREFIX = "/api/media/"

# Magic numbers -> (content type, extension). Checked on the bytes, never on the client's claim.
_SIGNATURES: list[tuple[bytes, int, str, str]] = [
    (b"\x89PNG\r\n\x1a\n", 0, "image/png", "png"),
    (b"\xff\xd8\xff", 0, "image/jpeg", "jpg"),
    (b"GIF87a", 0, "image/gif", "gif"),
    (b"GIF89a", 0, "image/gif", "gif"),
]


def sniff_image(data: bytes) -> tuple[str, str] | None:
    """Returns (content type, extension) for PNG, JPEG, GIF and WebP (incl. animated)."""
    for magic, offset, content_type, ext in _SIGNATURES:
        if data[offset : offset + len(magic)] == magic:
            return content_type, ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    return None


@lru_cache
def _client() -> Minio:
    s = get_settings()
    return Minio(s.minio_endpoint, access_key=s.minio_root_user, secret_key=s.minio_root_password, secure=s.minio_secure)


def _bucket() -> str:
    return get_settings().minio_bucket


async def ensure_bucket() -> None:
    def run() -> None:
        if not _client().bucket_exists(_bucket()):
            _client().make_bucket(_bucket())

    await to_thread.run_sync(run)


async def delete_prefix(prefix: str) -> None:
    """Deletes every object under a prefix (e.g. all of a user's uploads)."""

    def run() -> None:
        for obj in _client().list_objects(_bucket(), prefix=prefix, recursive=True):
            _client().remove_object(_bucket(), obj.object_name)

    await to_thread.run_sync(run)


async def put(key: str, data: bytes, content_type: str) -> None:
    await to_thread.run_sync(
        lambda: _client().put_object(_bucket(), key, io.BytesIO(data), len(data), content_type=content_type)
    )


async def delete(key: str) -> None:
    def run() -> None:
        try:
            _client().remove_object(_bucket(), key)
        except S3Error:
            pass  # already gone

    await to_thread.run_sync(run)


@dataclass
class StoredFile:
    data: bytes
    content_type: str


async def get(key: str) -> StoredFile | None:
    def run() -> StoredFile | None:
        try:
            response = _client().get_object(_bucket(), key)
        except S3Error as err:
            if err.code in ("NoSuchKey", "NoSuchBucket"):
                return None
            raise
        try:
            return StoredFile(response.read(), response.headers.get("Content-Type", "application/octet-stream"))
        finally:
            response.close()
            response.release_conn()

    return await to_thread.run_sync(run)


def url_for(key: str) -> str:
    """Path stored on the model; clients prefix it with the API base URL."""
    return MEDIA_PREFIX + key


def key_from_url(url: str | None) -> str | None:
    return url[len(MEDIA_PREFIX) :] if url and url.startswith(MEDIA_PREFIX) else None
