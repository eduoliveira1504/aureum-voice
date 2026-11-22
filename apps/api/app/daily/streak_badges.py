"""Keeps each person's daily game badges in step with their streaks (block 4.2.13).

After a solve, and every hour for everyone holding one (a streak ends when a day passes without
playing and no freeze is left), each game's badge becomes the level of the current streak: a new
or higher one is granted (and announced by @aureum), a broken streak takes it away. Where the
person featured the old level, the new one takes its place.
"""

import asyncio
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import badges
from app.daily import GAMES, today
from app.daily.streaks import LEVELS, Streak, badge_key, badge_prefix, level_of, streak_of
from app.db import SessionLocal
from app.models import Badge, DailyResult, User, UserBadge

log = logging.getLogger(__name__)

SWEEP_SECONDS = 60 * 60


async def streaks_of(session: AsyncSession, user_id: uuid.UUID) -> dict[str, Streak]:
    rows = await session.execute(
        select(DailyResult.game, DailyResult.day).where(DailyResult.user_id == user_id, DailyResult.completed.is_(True))
    )
    days: dict[str, set] = {key: set() for key in GAMES}
    for game, day in rows:
        days.setdefault(game, set()).add(day)
    now = today()
    return {key: streak_of(days[key], now) for key in GAMES}


async def sync(session: AsyncSession, user_id: uuid.UUID) -> list[str]:
    """Brings the user's daily badges in line with their streaks (committed). Returns the keys newly
    granted at a higher level than before, to announce."""
    user = await session.get(User, user_id)
    if user is None:
        return []
    streaks = await streaks_of(session, user_id)
    raised: list[str] = []
    changed = False
    for game, streak in streaks.items():
        level = level_of(streak.days)
        want = badge_key(game, level) if level else None
        held = next((g for g in user.badge_grants if g.badge.key.startswith(badge_prefix(game))), None)
        if (held.badge.key if held else None) == want:
            continue
        featured = held.featured_position if held else None
        old_level = int(held.badge.key.rsplit("_", 1)[1]) if held else 0
        if held is not None:
            await badges.revoke(session, user, held.badge.key)
        if want is not None:
            granted = await badges.grant(session, user, want)
            if granted is not None:
                granted.featured_position = featured
                if level and level > old_level:
                    raised.append(want)
        changed = True
    if changed:
        await session.commit()
        await badges.announce(session, user)
    return raised


async def sync_and_announce(user_id: uuid.UUID) -> None:
    from app import bot

    async with SessionLocal() as session:
        raised = await sync(session, user_id)
    for key in raised:
        await bot.badge_granted(user_id, key)


async def holders(session: AsyncSession) -> list[uuid.UUID]:
    keys = [badge_key(game, level) for game in GAMES for level in LEVELS]
    rows = await session.scalars(
        select(UserBadge.user_id).join(Badge, Badge.id == UserBadge.badge_id).where(Badge.key.in_(keys)).distinct()
    )
    return list(rows)


async def run_sweeper() -> None:
    """Every hour: anyone holding a daily badge gets it checked, so a streak that ended loses it."""
    while True:
        await asyncio.sleep(SWEEP_SECONDS)
        try:
            async with SessionLocal() as session:
                ids = await holders(session)
            for user_id in ids:
                await sync_and_announce(user_id)
        except Exception:
            log.exception("Daily streak sweep failed")
