"""GIFs from Klipy (block 3.11C; docs/decisions/0034-stickers-and-gifs.md).

Klipy's integration rules (docs.klipy.com/integration-requirements) say search and trending must
be called from the user's app, and media loaded straight from Klipy's URLs, never proxied,
cached or re-hosted by us. So the app searches Klipy itself, with the app key this API hands it
(GET /gifs/config; the key lives in .env and can be swapped without a release) and an anonymous
`customer_id` per user (an HMAC of their id: stable for Klipy, meaningless outside).

What the API keeps is what was sent: a GIF message stores the provider, the GIF's id, title,
dimensions and the media URLs Klipy returned, exactly as given, and only URLs on Klipy's media
hosts (static*.klipy.com over https). Favorites are kept the same way, per user.
"""

import hashlib
import hmac
import re
import uuid
from typing import Any
from urllib.parse import urlsplit

from app.config import get_settings

PROVIDER = "klipy"
# Klipy's media hosts (docs.klipy.com/network-requirements).
MEDIA_HOST = re.compile(r"^static\d*\.klipy\.com$")
MAX_FAVORITES = 200
# What the app asks Klipy for: the safest content filter, Brazil's localized results.
CONTENT_FILTER = "high"
LOCALE = "br"


def enabled() -> bool:
    return bool(get_settings().klipy_app_key)


def customer_id(user_id: uuid.UUID) -> str:
    """Klipy's per-user id: the same for a user every time, not their id."""
    key = get_settings().jwt_secret.encode()
    return hmac.new(key, b"klipy-customer:" + user_id.bytes, hashlib.sha256).hexdigest()[:32]


def media_url_ok(url: str) -> bool:
    parts = urlsplit(url)
    return parts.scheme == "https" and bool(parts.hostname) and bool(MEDIA_HOST.match(parts.hostname or "")) and not parts.username


def fallback(title: str) -> str:
    """What apps that don't know GIFs show instead."""
    return f"[GIF: {title}]" if title else "[GIF]"


def snapshot(gif: Any) -> dict[str, Any]:
    """A GifIn as a message (or a favorite) keeps it."""
    return {"provider": PROVIDER, **gif.model_dump(mode="json")}
