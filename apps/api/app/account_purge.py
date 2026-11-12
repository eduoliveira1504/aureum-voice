"""Cleaning up fake accounts: `python -m app.cli accounts purge` (block 4.2.2, ADR 0049).

A candidate never confirmed its e-mail, is in no server, never sent a message, was created more
than N days ago and isn't an official or bot account. Deleting uses the same
app.account_deletion.finalize as a requested deletion, with no grace period and no e-mail (the
address was never confirmed, so it may not even be theirs).
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import account_deletion
from app.models import Message, ServerMember, User

DEFAULT_DAYS = 30


@dataclass(frozen=True)
class Candidate:
    user: User

    def line(self) -> str:
        u = self.user
        return f"@{u.username:<32} {u.email:<40} criada em {u.created_at:%d/%m/%Y}"


async def candidates(session: AsyncSession, days: int = DEFAULT_DAYS) -> list[Candidate]:
    cutoff = datetime.now(UTC) - timedelta(days=days)
    users = await session.scalars(
        select(User)
        .where(
            User.email_verified_at.is_(None),
            User.created_at < cutoff,
            User.is_official.is_(False),
            User.is_bot.is_(False),
            ~select(ServerMember.user_id).where(ServerMember.user_id == User.id).exists(),
            ~select(Message.id).where(Message.author_id == User.id).exists(),
        )
        .order_by(User.created_at)
    )
    return [Candidate(u) for u in users]


async def purge(session: AsyncSession, confirmed: list[Candidate], days: int = DEFAULT_DAYS) -> int:
    """Deletes the confirmed candidates that still are candidates now (one that confirmed its
    e-mail or joined a server since the list was shown is left alone). Returns how many."""
    wanted = {c.user.id for c in confirmed}
    done = 0
    for candidate in await candidates(session, days):
        if candidate.user.id in wanted:
            done += await account_deletion.finalize(session, candidate.user, notify=False)
    return done
