"""Automatic release announcements: when a new app version is published on GitHub, @aureum says
so in the avisos channel and sends it as a "novidades" DM to everyone who accepts it.

A worker in the API reads the repository's public releases every 15 minutes (GitHub's public
API: no token, no cost, well under its 60 requests an hour). Only the newest release published
in the last few days counts, so switching this on never announces old versions, and each tag
is announced once (bot_releases), however many API processes or restarts there are. The notes
are the release's text on GitHub (`npm run release` fills it from CHANGELOG.md).

Switched with the CLI like the other actions (`bot enable --acao novidades`); the channel is
the avisos one.
"""

import asyncio
import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy.dialects.postgresql import insert

from app import bot
from app.bot import broadcast
from app.config import get_settings
from app.db import SessionLocal
from app.models import BotRelease

log = logging.getLogger(__name__)

POLL_SECONDS = 15 * 60
FIRST_CHECK_SECONDS = 60
RECENT = timedelta(days=3)
NOTES_MAX = 3000


async def fetch() -> list[dict[str, Any]]:
    """The repository's latest releases, from GitHub's public API."""
    repo = get_settings().aureum_releases_repo.strip()
    if not repo:
        return []
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(
            f"https://api.github.com/repos/{repo}/releases",
            params={"per_page": 10},
            headers={"Accept": "application/vnd.github+json", "User-Agent": "aureum-voice-api"},
        )
        res.raise_for_status()
        return res.json()


def newest(releases: list[dict[str, Any]], now: datetime) -> dict[str, Any] | None:
    """The newest release published (not a draft) within RECENT, if any."""
    published = [
        (datetime.fromisoformat(r["published_at"].replace("Z", "+00:00")), r)
        for r in releases
        if not r.get("draft") and r.get("published_at") and r.get("tag_name")
    ]
    recent = [(when, r) for when, r in published if now - when <= RECENT]
    return max(recent, key=lambda pair: pair[0])[1] if recent else None


def notes(body: str | None) -> str:
    """The release text as a chat message: CHANGELOG-style markdown made flat (headings in bold,
    "- " items as bullets, wrapped lines joined), cut to fit."""
    lines: list[str] = []
    for raw in (body or "").replace("\r", "").split("\n"):
        stripped = raw.strip()
        if not stripped:
            if lines and lines[-1]:
                lines.append("")
            continue
        if heading := re.match(r"#+\s+(.*)", stripped):
            lines.append(f"**{heading.group(1).strip()}**")
        elif item := re.match(r"[-*]\s+(.*)", stripped):
            lines.append(f"• {item.group(1)}")
        elif lines and lines[-1] and raw[:1].isspace():
            lines[-1] += f" {stripped}"  # a wrapped line of the item above
        else:
            lines.append(stripped)
    text = "\n".join(lines).strip()
    return text if len(text) <= NOTES_MAX else text[: NOTES_MAX - 1].rstrip() + "…"


async def announce(release: dict[str, Any]) -> bool:
    """Posts and queues the DMs for this release, unless the action is off or it was announced
    already. Returns whether it announced it."""
    tag = str(release["tag_name"])[:64]
    async with SessionLocal() as session:
        account = await bot.bot_user(session)
        if account is None or not await bot.enabled(session, bot.RELEASES):
            return False
        claimed = await session.scalar(insert(BotRelease).values(tag=tag).on_conflict_do_nothing().returning(BotRelease.tag))
        if claimed is None:
            return False
        await session.commit()
        version = tag.removeprefix("v")
        extra = notes(release.get("body"))
        extra = f"\n\n{extra}" if extra else ""
        channel = await bot.server_channel(session, bot.NOTICES)
        if channel is not None:
            await bot.post(session, account.id, channel, bot.text("servidor", "versao_nova", versao=version) + extra, {"category": "novidades"})
        content = bot.text("dm", "versao_nova", versao=version) + extra
        users = await broadcast.recipients(session, bot.NEWS, broadcast.key_of(bot.NEWS, content))
        await broadcast.queue(session, bot.NEWS, content, users)
        await session.commit()
    log.info("Bot: announced release %s", tag)
    return True


async def check(now: datetime | None = None) -> bool:
    release = newest(await fetch(), now or datetime.now(UTC))
    return release is not None and await announce(release)


async def run_worker() -> None:
    """Runs for the life of the API process."""
    await asyncio.sleep(FIRST_CHECK_SECONDS)
    while True:
        try:
            await check()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Bot: release check failed; trying again later")
        await asyncio.sleep(POLL_SECONDS)
