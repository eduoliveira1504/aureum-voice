"""The newest Windows installer, from this repository's GitHub releases (RELEASES_REPO).

Asked of GitHub's public API without a token (free, 60 requests/hour per IP) and cached, so
the invite page and welcome e-mails cost one request every few minutes at most. Beta builds
are published as pre-releases, which /releases/latest skips, hence the list of releases."""

import logging
import time
from dataclasses import dataclass

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)

CACHE_SECONDS = 10 * 60


@dataclass(frozen=True)
class Release:
    url: str  # the .exe itself, or the releases page when no installer was found
    version: str | None = None
    size_bytes: int | None = None


_cache: tuple[float, Release] | None = None


def releases_page() -> str:
    return f"https://github.com/{get_settings().releases_repo}/releases"


async def _fetch() -> Release:
    repo = get_settings().releases_repo
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            f"https://api.github.com/repos/{repo}/releases",
            params={"per_page": 10},
            headers={"Accept": "application/vnd.github+json"},
        )
        res.raise_for_status()
    for release in res.json():
        if release.get("draft"):
            continue
        for asset in release.get("assets", []):
            if asset.get("name", "").lower().endswith(".exe"):
                return Release(
                    url=asset["browser_download_url"],
                    version=(release.get("tag_name") or "").lstrip("v") or None,
                    size_bytes=asset.get("size"),
                )
    return Release(url=releases_page())


async def latest() -> Release:
    """Never fails: without GitHub, the releases page is still a working link."""
    global _cache
    if _cache is not None and time.monotonic() - _cache[0] < CACHE_SECONDS:
        return _cache[1]
    try:
        release = await _fetch()
    except Exception:
        log.warning("Could not read the GitHub releases", exc_info=True)
        release = _cache[1] if _cache else Release(url=releases_page())
    _cache = (time.monotonic(), release)
    return release
