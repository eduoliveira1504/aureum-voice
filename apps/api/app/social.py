"""Friendships and blocks: the rules every social feature (DMs, calls, presence) builds on."""

import uuid

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Friendship, FriendshipStatus


def between(a: uuid.UUID, b: uuid.UUID):  # noqa: ANN202
    """Filter for the rows between two users, in either direction."""
    return or_(
        and_(Friendship.requester_id == a, Friendship.addressee_id == b),
        and_(Friendship.requester_id == b, Friendship.addressee_id == a),
    )


async def pair_rows(session: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> list[Friendship]:
    """Every row between two users: a request or friendship, and up to two blocks."""
    return list(await session.scalars(select(Friendship).where(between(a, b)).with_for_update()))


async def are_friends(session: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> bool:
    row = await session.scalar(
        select(Friendship.status).where(between(a, b), Friendship.status == FriendshipStatus.accepted)
    )
    return row is not None


async def blocked_either_way(session: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> bool:
    row = await session.scalar(
        select(Friendship.status).where(between(a, b), Friendship.status == FriendshipStatus.blocked)
    )
    return row is not None


async def friend_ids(session: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    rows = await session.execute(
        select(Friendship.requester_id, Friendship.addressee_id).where(
            Friendship.status == FriendshipStatus.accepted,
            or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id),
        )
    )
    return {b if a == user_id else a for a, b in rows}


async def blocked_by_or_blocking(session: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    """Users the given user blocked or was blocked by."""
    rows = await session.execute(
        select(Friendship.requester_id, Friendship.addressee_id).where(
            Friendship.status == FriendshipStatus.blocked,
            or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id),
        )
    )
    return {b if a == user_id else a for a, b in rows}
