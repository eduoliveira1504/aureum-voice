"""Deactivating and reactivating an account (block 4.2.2, ADR 0049).

A deactivated account keeps everything (servers, messages, friendships) but disappears for
everyone else: its sessions end, it's offline, it leaves friend lists, its profile shows only the
name and avatar, and nobody can start a DM, a group or a friend request with it. Signing in again
with e-mail and password brings it all back at once. Deletion (app/account_deletion.py) starts
from a deactivated account.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Friendship, FriendshipStatus, User
from app.realtime import broker


async def _friendship_rows(session: AsyncSession, user_id: uuid.UUID) -> list[Friendship]:
    """Friends and pending requests, both ways (blocks stay as they are)."""
    return list(
        await session.scalars(
            select(Friendship).where(
                Friendship.status != FriendshipStatus.blocked,
                or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id),
            )
        )
    )


def _other(row: Friendship, user_id: uuid.UUID) -> uuid.UUID:
    return row.addressee_id if row.requester_id == user_id else row.requester_id


async def deactivate(session: AsyncSession, user: User) -> None:
    """Commits. Every session of the account ends (no new tokens: signing in again reactivates)."""
    if user.deactivated_at is None:
        user.deactivated_at = datetime.now(UTC)
    user.session_epoch += 1
    rows = await _friendship_rows(session, user.id)
    await session.commit()
    await broker.end_sessions(user.id, user.session_epoch)
    for row in rows:
        await broker.publish("friend.removed", {"user_id": str(user.id)}, [_other(row, user.id)])


async def reactivate(session: AsyncSession, user: User) -> None:
    """Commits. Friends and requests show up again on the other side."""
    from app.routers.friends import announce_to

    user.deactivated_at = None
    user.deletion_due_at = None
    user.delete_messages = False
    await session.commit()
    for row in await _friendship_rows(session, user.id):
        await announce_to(session, row, _other(row, user.id))
