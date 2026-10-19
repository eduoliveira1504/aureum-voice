"""Outgoing e-mail. Requests only queue a row in email_outbox (enqueue, committed with the rest
of the request); a background worker in the API sends it, retrying with backoff, so a slow or
broken SMTP server never holds up the API. The CLI queues the same way and the API sends.

Never logged: codes, message bodies, credentials or full addresses (only masked ones)."""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.mail.providers import get_provider
from app.mail.render import NAMES, mask, render
from app.models import OutboxEmail

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 5
# Wait before each retry (after the 1st, 2nd, 3rd and 4th failures).
BACKOFF = (timedelta(seconds=30), timedelta(minutes=2), timedelta(minutes=10), timedelta(minutes=30))
POLL_SECONDS = 2.0
BRASILIA = timedelta(hours=-3)


def enqueue(session: AsyncSession, to: str, template: str, **params: Any) -> None:
    """Queues an e-mail; it goes out once the session commits."""
    if template not in NAMES:
        raise KeyError(template)
    session.add(OutboxEmail(to_address=to, template=template, params=params))


def when(moment: datetime | None = None) -> str:
    """'19/10/2026 às 14:05, horário de Brasília', for security notices."""
    local = (moment or datetime.now(UTC)).astimezone(UTC) + BRASILIA
    return local.strftime("%d/%m/%Y às %H:%M") + ", horário de Brasília"


async def send_due(limit: int = 20) -> int:
    """Sends what is due; returns how many rows it handled. Rows are locked with SKIP LOCKED, so
    several API processes can run this side by side."""
    provider = get_provider()
    async with SessionLocal() as session:
        now = datetime.now(UTC)
        rows = (
            await session.scalars(
                select(OutboxEmail)
                .where(OutboxEmail.failed_at.is_(None), OutboxEmail.next_attempt_at <= now)
                .order_by(OutboxEmail.id)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        ).all()
        for row in rows:
            try:
                await provider.send(await render(row.template, row.to_address, row.params))
            except Exception as exc:
                row.attempts += 1
                row.last_error = f"{type(exc).__name__}: {exc}"[:300]
                if row.attempts >= MAX_ATTEMPTS:
                    # Given up: keep the record, drop what's sensitive (codes, the address).
                    row.failed_at = now
                    row.params = {}
                    row.to_address = mask(row.to_address)
                    log.warning("Gave up on e-mail %s #%s to %s: %s", row.template, row.id, row.to_address, row.last_error)
                else:
                    row.next_attempt_at = now + BACKOFF[row.attempts - 1]
                    log.info("E-mail %s #%s failed (try %s), retrying later", row.template, row.id, row.attempts)
            else:
                log.info("Sent e-mail %s #%s to %s", row.template, row.id, mask(row.to_address))
                await session.delete(row)
        await session.commit()
        return len(rows)


async def run_worker() -> None:
    """Runs for the life of the API process."""
    while True:
        try:
            while await send_due():
                pass
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("E-mail worker failed; trying again shortly")
        await asyncio.sleep(POLL_SECONDS)
