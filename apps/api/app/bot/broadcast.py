"""`bot broadcast`: one official DM to everyone who accepts the category (avisos, novidades).

The CLI only queues (bot_outbox); a worker in the API sends at a steady pace, so a broadcast to
everyone never floods the database or the WebSocket. The key comes from the category and the
text, so the same message never reaches anyone twice (bot_deliveries), and running the same
command again picks up whoever is still missing after an interruption.
"""

import asyncio
import hashlib
import logging
import uuid

from sqlalchemy import and_, exists, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import bot
from app.db import SessionLocal
from app.models import BotDelivery, BotOutbox, User, UserSettings

log = logging.getLogger(__name__)

PER_SECOND = 5
POLL_SECONDS = 2.0


def key_of(category: str, content: str) -> str:
    return "broadcast:" + hashlib.sha256(f"{category}\n{content}".encode()).hexdigest()[:32]


async def recipients(session: AsyncSession, category: str, key: str) -> list[uuid.UUID]:
    """Confirmed, non-official accounts that accept the category and haven't had this one."""
    turned_off = exists().where(
        UserSettings.user_id == User.id, UserSettings.official_dm[category].astext == "false"
    )
    delivered = exists().where(BotDelivery.user_id == User.id, BotDelivery.key == key)
    rows = await session.scalars(
        select(User.id).where(
            User.is_official.is_(False), User.email_verified_at.is_not(None), ~turned_off, ~delivered
        )
    )
    return list(rows)


async def queue(session: AsyncSession, category: str, content: str, user_ids: list[uuid.UUID]) -> None:
    """Queues the DM for these users (not committed). Rows of an earlier run that were taken
    but never delivered go back in line."""
    key = key_of(category, content)
    if user_ids:
        await session.execute(
            insert(BotOutbox)
            .values([{"user_id": u, "key": key, "category": category, "content": content} for u in user_ids])
            .on_conflict_do_nothing()
        )
    delivered = exists().where(and_(BotDelivery.user_id == BotOutbox.user_id, BotDelivery.key == BotOutbox.key))
    await session.execute(update(BotOutbox).where(BotOutbox.key == key, ~delivered).values(sent_at=None))


async def pending(session: AsyncSession) -> int:
    return len(list(await session.scalars(select(BotOutbox.id).where(BotOutbox.sent_at.is_(None)))))


async def send_due(limit: int = PER_SECOND) -> int:
    """Sends up to `limit` queued DMs; returns how many it took. Rows are claimed first (sent_at
    set, SKIP LOCKED), so two API processes never take the same one."""
    async with SessionLocal() as session:
        claimed = (
            await session.execute(
                text(
                    "UPDATE bot_outbox SET sent_at = now() WHERE id IN ("
                    " SELECT id FROM bot_outbox WHERE sent_at IS NULL ORDER BY id LIMIT :n FOR UPDATE SKIP LOCKED"
                    ") RETURNING user_id, key, category, content"
                ),
                {"n": limit},
            )
        ).all()
        await session.commit()
    for user_id, key, category, content in claimed:
        try:
            async with SessionLocal() as session:
                user = await session.get(User, user_id)
                if user is not None:
                    await bot.send_dm(session, user, category, content, key=key)
        except Exception:
            # Left as taken: running the same broadcast again puts it back in line.
            log.exception("Bot: broadcast DM failed")
    return len(claimed)


async def run_worker() -> None:
    """Runs for the life of the API process: at most PER_SECOND DMs a second."""
    while True:
        try:
            while await send_due():
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Bot: broadcast worker failed; trying again shortly")
        await asyncio.sleep(POLL_SECONDS)
