"""Link previews: a card with a link's site, title, description and image.

The API fetches them, never the app, so the people who receive a message don't show their IP to
the site. Fetching goes through app/safe_fetch.py (public addresses only, limits). Pages give
their OpenGraph / Twitter card tags; YouTube links use its oEmbed (title and channel, no key
needed) and get a big thumbnail. The image is fetched here too, made a WebP of at most
IMAGE_MAX px and stored under previews/, so it is served by /api/media like an avatar.

Up to MAX_PER_MESSAGE links per message; a link written between < > is left out. Each URL's
result is cached in Redis for CACHE_SECONDS ("nothing to show" for EMPTY_CACHE_SECONDS).

Cards are filled after the message is sent (schedule), so sending never waits for a site: the
message goes out without them, and "message.updated" brings them. The author can remove them
(`previews_removed`), and then an edit doesn't bring them back. A forward carries the original's.
"""

import asyncio
import hashlib
import io
import json
import logging
import re
from html.parser import HTMLParser
from typing import Any
from urllib.parse import quote, urljoin, urlsplit

import httpx
from anyio import to_thread
from PIL import Image

from app import safe_fetch, storage
from app.config import get_settings
from app.realtime import broker

log = logging.getLogger(__name__)

MAX_PER_MESSAGE = 3
CACHE_SECONDS = 24 * 3600
# A link that gave nothing (or failed) is tried again sooner.
EMPTY_CACHE_SECONDS = 3600
IMAGE_MAX = 640
PREFIX = "previews/"
TITLE_MAX = 200
DESCRIPTION_MAX = 300

# Same rule as the app's links (components/ChatView.tsx, Linkified), plus the < > around it.
URL_RE = re.compile(r"""(<?)(https?://[^\s<>]+[^\s<>.,:;"')\]!?])(>?)""")
YOUTUBE_RE = re.compile(
    r"^https?://(?:(?:www\.|m\.|music\.)?youtube\.com/(?:watch\?(?:[^#]*&)?v=|shorts/|live/|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)


def links(content: str) -> list[str]:
    """The links of a message that get a card, in order, without repeats."""
    found = [url for open_, url, close in URL_RE.findall(content) if not (open_ and close)]
    return list(dict.fromkeys(found))[:MAX_PER_MESSAGE]


# --- Reading pages ---------------------------------------------------------------------------


class _Head(HTMLParser):
    """The <meta> tags and <title> of a page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "meta":
            key = (values.get("property") or values.get("name") or "").strip().lower()
            content = (values.get("content") or "").strip()
            if key and content:
                self.meta.setdefault(key, content)
        elif tag == "title" and not self.title:
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data


_CHARSET_RE = re.compile(rb"""<meta[^>]+charset=["']?([A-Za-z0-9_-]+)""", re.I)
_BODY_RE = re.compile(r"<body[\s>]", re.I)


def _decode(body: bytes, charset: str | None) -> str:
    if charset is None and (found := _CHARSET_RE.search(body[:4096])):
        charset = found.group(1).decode("ascii")
    try:
        return body.decode(charset or "utf-8", errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


def _clip(text: str | None, limit: int) -> str | None:
    text = " ".join((text or "").split())
    if not text:
        return None
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _site_of(url: str) -> str:
    host = urlsplit(url).hostname or ""
    return host.removeprefix("www.")


def parse_page(html: str, url: str) -> dict[str, Any] | None:
    """What a page says about itself (`url` is where it ended up, for relative images). None when
    it has neither a title nor a description."""
    head = _Head()
    match = _BODY_RE.search(html)
    head.feed(html[: match.start()] if match else html)
    meta = head.meta
    title = _clip(meta.get("og:title") or meta.get("twitter:title") or head.title, TITLE_MAX)
    description = _clip(
        meta.get("og:description") or meta.get("twitter:description") or meta.get("description"), DESCRIPTION_MAX
    )
    if not title and not description:
        return None
    image = meta.get("og:image:secure_url") or meta.get("og:image") or meta.get("og:image:url") or meta.get("twitter:image")
    return {
        "site": _clip(meta.get("og:site_name"), 80) or _site_of(url),
        "title": title,
        "description": description,
        "image_source": urljoin(url, image) if image else None,
    }


# --- Images ----------------------------------------------------------------------------------


def _to_webp(data: bytes) -> tuple[bytes, int, int]:
    with Image.open(io.BytesIO(data)) as image:
        if image.width * image.height > 40_000_000:
            raise ValueError("image too large")
        image.seek(0)
        frame = image.convert("RGBA" if image.mode in ("RGBA", "LA", "P") else "RGB")
        frame.thumbnail((IMAGE_MAX, IMAGE_MAX))
        out = io.BytesIO()
        frame.save(out, "WEBP", quality=80)
        return out.getvalue(), frame.width, frame.height


async def _store_image(url: str) -> dict[str, Any] | None:
    """The card's image, kept as our own WebP (named by its content, so it never goes stale)."""
    try:
        fetched = await safe_fetch.fetch(url, accept="image/*")
        if storage.sniff_image(fetched.body) is None:
            return None
        data, width, height = await to_thread.run_sync(_to_webp, fetched.body)
    except (safe_fetch.Blocked, httpx.HTTPError, TimeoutError, OSError, ValueError, Image.DecompressionBombError):
        return None
    key = f"{PREFIX}{hashlib.sha256(data).hexdigest()[:40]}.webp"
    await storage.put(key, data, "image/webp")
    return {"image": storage.url_for(key), "image_width": width, "image_height": height}


# --- Building a card -------------------------------------------------------------------------


async def _youtube(url: str, video_id: str) -> dict[str, Any] | None:
    watch = f"https://www.youtube.com/watch?v={video_id}"
    fetched = await safe_fetch.fetch(f"https://www.youtube.com/oembed?format=json&url={quote(watch, safe='')}", accept="application/json")
    info = json.loads(fetched.body)
    if not isinstance(info, dict):
        return None
    card: dict[str, Any] = {
        "url": url,
        "kind": "youtube",
        "site": "YouTube",
        "title": _clip(info.get("title"), TITLE_MAX),
        "description": None,
        "channel": _clip(info.get("author_name"), 100),
        "video_id": video_id,
    }
    # The big thumbnail (oEmbed's is the same one, as hqdefault).
    image = await _store_image(f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")
    return {**card, **(image or {})}


async def _page(url: str) -> dict[str, Any] | None:
    fetched = await safe_fetch.fetch(url, accept="text/html,application/xhtml+xml;q=0.9,*/*;q=0.5")
    if fetched.content_type not in ("text/html", "application/xhtml+xml"):
        return None
    page = parse_page(_decode(fetched.body, fetched.charset), fetched.url)
    if page is None:
        return None
    source = page.pop("image_source")
    image = await _store_image(source) if source else None
    return {"url": url, "kind": "link", **page, **(image or {})}


async def build(url: str) -> dict[str, Any] | None:
    """A card for `url`, or None when there's nothing to show (or it can't be fetched)."""
    try:
        if match := YOUTUBE_RE.match(url):
            return await _youtube(url, match.group(1))
        return await _page(url)
    except (safe_fetch.Blocked, httpx.HTTPError, TimeoutError, OSError, ValueError) as exc:
        log.info("No preview for a link: %s", type(exc).__name__)
        return None


def _cache_key(url: str) -> str:
    return f"{get_settings().redis_prefix}:lp:{hashlib.sha256(url.encode()).hexdigest()}"


async def preview(url: str) -> dict[str, Any] | None:
    cached = await broker.redis.get(_cache_key(url))
    if cached is not None:
        return json.loads(cached)
    card = await build(url)
    await broker.redis.set(_cache_key(url), json.dumps(card), ex=CACHE_SECONDS if card else EMPTY_CACHE_SECONDS)
    return card


async def previews_for(content: str) -> list[dict[str, Any]]:
    cards = await asyncio.gather(*(preview(url) for url in links(content)))
    return [card for card in cards if card is not None]


# --- Filling messages ------------------------------------------------------------------------

_tasks: set[asyncio.Task[None]] = set()


def schedule(message_id: int, content: str) -> None:
    """Fills the message's cards in the background, if it has links."""
    if not links(content):
        return
    task = asyncio.create_task(_fill(message_id, content))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def settle() -> None:
    """Waits for the cards being filled (tests)."""
    while _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


async def _fill(message_id: int, content: str) -> None:
    from app.access import channel_audience
    from app.db import SessionLocal
    from app.models import Channel, Message
    from app.schemas import MessageOut

    try:
        cards = await previews_for(content)
        async with SessionLocal() as session:
            message = await session.get(Message, message_id)
            # Edited or removed meanwhile: that edit decides.
            if message is None or message.content != content or message.previews_removed or message.link_previews == cards:
                return
            message.link_previews = cards
            await session.commit()
            await session.refresh(message, ["author", "reply_to"])
            channel = await session.get(Channel, message.channel_id)
            assert channel is not None
            out = MessageOut.model_validate(message)
            await broker.publish("message.updated", out.model_dump(mode="json"), await channel_audience(session, channel))
    except Exception:
        log.exception("Could not fill the link previews of message %s", message_id)
