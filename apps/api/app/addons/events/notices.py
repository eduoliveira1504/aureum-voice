"""@aureum DMs about events, only to whoever said Vou or Talvez: reminders a day and 15 minutes
before, "começou" at the start, and a notice when an event changes time or is cancelled."""

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.addons.base import event_notice
from app.addons.events import occurrences
from app.addons.events.models import Event, EventResponse
from app.db import SessionLocal

log = logging.getLogger(__name__)

# (message in mensagens.toml, how long before the start).
REMINDERS = (("evento_dia", timedelta(days=1)), ("evento_15min", timedelta(minutes=15)), ("evento_comecou", timedelta(0)))
# A reminder still goes out this long after its time (the API was restarting); later, it's skipped.
GRACE = timedelta(minutes=10)
POLL_SECONDS = 30


async def attending(session: AsyncSession, event_id: uuid.UUID, index: int) -> list[uuid.UUID]:
    """Who said Vou or Talvez to this occurrence."""
    rows = await session.scalars(
        select(EventResponse.user_id).where(
            EventResponse.event_id == event_id,
            EventResponse.occurrence == index,
            EventResponse.status.in_(("going", "maybe")),
        )
    )
    return list(rows)


async def notify(session: AsyncSession, event: Event, occ: occurrences.Occurrence, message: str, key: str) -> None:
    users = await attending(session, event.id, occ.index)
    await event_notice(
        session,
        event.workspace_id,
        users,
        message,
        key=key,
        title=event.title,
        item_id=event.id,
        starts_at=occ.starts_at,
        room_id=event.location_channel_id,
        place=event.location_text,
    )


async def send_reminders(now: datetime | None = None) -> int:
    """Sends the reminders whose time has come (each once: the bot keeps what it delivered).
    Returns how many reminders were due, whoever got them."""
    now = now or datetime.now(UTC)
    horizon = now + REMINDERS[0][1] + GRACE
    due = 0
    async with SessionLocal() as session:
        events = list(
            await session.scalars(
                select(Event).where(
                    Event.cancelled_at.is_(None),
                    Event.starts_at <= horizon,
                    or_(Event.repeat == "weekly", Event.ends_at > now - GRACE),
                )
            )
        )
        for event in events:
            for occ in occurrences.between(event.starts_at, event.ends_at, event.timezone, event.repeat, now - GRACE, horizon):
                for message, before in REMINDERS:
                    at = occ.starts_at - before
                    if not at <= now < at + GRACE:
                        continue
                    due += 1
                    # The start time is in the key: an event moved to another time is reminded again.
                    key = f"event:{event.id}:{occ.index}:{message}:{int(occ.starts_at.timestamp())}"
                    await notify(session, event, occ, message, key)
    return due


async def run_worker() -> None:
    while True:
        try:
            await send_reminders()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Events: reminder worker failed; trying again shortly")
        await asyncio.sleep(POLL_SECONDS)
