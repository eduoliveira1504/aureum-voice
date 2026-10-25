"""Read state: unread counters and @username mentions per channel and user.

Minimal on purpose (no push notifications or per-channel settings yet): each user has a
last-read message id per text channel. Unread messages are the ones after it written by
someone else, and mentions are counted as messages arrive.
"""

import re
import uuid

from sqlalchemy import ColumnElement, and_, delete, func, literal, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Channel, ChannelRead, ChannelType, Message, User

# "@name" not preceded by a word character, so e-mail addresses don't count as mentions.
MENTION_RE = re.compile(r"(?<![\w.])@([A-Za-z0-9_.]{3,32})")


def mentioned_usernames(content: str) -> set[str]:
    return {name.lower().rstrip(".") for name in MENTION_RE.findall(content)}


async def seed(session: AsyncSession, user_id: uuid.UUID, server_id: uuid.UUID) -> None:
    """Marks a server's text channels read up to now (for someone who just joined it)."""
    latest = (
        select(
            literal(user_id, ChannelRead.user_id.type),
            Channel.id,
            func.coalesce(func.max(Message.id), 0),
        )
        .select_from(Channel)
        .outerjoin(Message, Message.channel_id == Channel.id)
        .where(Channel.server_id == server_id, Channel.type == ChannelType.text)
        .group_by(Channel.id)
    )
    await session.execute(
        insert(ChannelRead)
        .from_select(["user_id", "channel_id", "last_read_message_id"], latest)
        .on_conflict_do_nothing()
    )


async def seed_channel(session: AsyncSession, user_id: uuid.UUID, channel_id: uuid.UUID) -> None:
    """Marks one channel read up to now (someone added to a group doesn't get its history as unread)."""
    latest = await session.scalar(select(func.max(Message.id)).where(Message.channel_id == channel_id)) or 0
    await session.execute(
        insert(ChannelRead)
        .values(user_id=user_id, channel_id=channel_id, last_read_message_id=latest)
        .on_conflict_do_nothing()
    )


async def forget_server(session: AsyncSession, user_id: uuid.UUID, server_id: uuid.UUID) -> None:
    channels = select(Channel.id).where(Channel.server_id == server_id)
    await session.execute(
        delete(ChannelRead).where(ChannelRead.user_id == user_id, ChannelRead.channel_id.in_(channels))
    )


async def record_mentions(
    session: AsyncSession, message: Message, viewers: list[uuid.UUID], also: uuid.UUID | None = None
) -> list[uuid.UUID]:
    """Counts the message's @username mentions of people who can see the channel (not
    committed), plus `also` (the author of the message a reply mentions). Returns who was
    mentioned."""
    names = mentioned_usernames(message.content)
    found = set(await session.scalars(select(User.id).where(User.id.in_(viewers), User.username.in_(names)))) if names else set()
    if also is not None and also in viewers:
        found.add(also)
    mentioned = [u for u in found if u != message.author_id]
    for user_id in mentioned:
        await session.execute(
            insert(ChannelRead)
            .values(user_id=user_id, channel_id=message.channel_id, mention_count=1)
            .on_conflict_do_update(
                index_elements=[ChannelRead.user_id, ChannelRead.channel_id],
                set_={"mention_count": ChannelRead.mention_count + 1},
            )
        )
    return mentioned


def _unread_messages(user_id: uuid.UUID):  # noqa: ANN202
    """Join condition for messages after the user's read marker, written by someone else."""
    return and_(
        Message.channel_id == Channel.id,
        Message.id > func.coalesce(ChannelRead.last_read_message_id, 0),
        or_(Message.author_id.is_(None), Message.author_id != user_id),
    )


def _with_read_marker(user_id: uuid.UUID):  # noqa: ANN202
    return and_(ChannelRead.channel_id == Channel.id, ChannelRead.user_id == user_id)


ReadRow = tuple[uuid.UUID, int, int, int]


async def _states(session: AsyncSession, user_id: uuid.UUID, *where: ColumnElement[bool]) -> list[ReadRow]:
    rows = await session.execute(
        select(
            Channel.id,
            func.coalesce(ChannelRead.last_read_message_id, 0),
            func.count(Message.id),
            func.coalesce(ChannelRead.mention_count, 0),
        )
        .select_from(Channel)
        .outerjoin(ChannelRead, _with_read_marker(user_id))
        .outerjoin(Message, _unread_messages(user_id))
        .where(*where)
        .group_by(Channel.id, ChannelRead.last_read_message_id, ChannelRead.mention_count)
    )
    return [tuple(r) for r in rows]  # type: ignore[misc]


async def server_states(session: AsyncSession, user_id: uuid.UUID, server_id: uuid.UUID) -> list[ReadRow]:
    """(channel_id, last_read_message_id, unread_count, mention_count) per text channel."""
    return await _states(session, user_id, Channel.server_id == server_id, Channel.type == ChannelType.text)


async def channel_states(session: AsyncSession, user_id: uuid.UUID, channel_ids: list[uuid.UUID]) -> dict[uuid.UUID, ReadRow]:
    """The same, for some channels (DMs), by channel id."""
    if not channel_ids:
        return {}
    return {row[0]: row for row in await _states(session, user_id, Channel.id.in_(channel_ids))}


async def unread_feed(session: AsyncSession, user_id: uuid.UUID, channel_ids: list[uuid.UUID], limit: int) -> list[Message]:
    """The newest unread messages across some text channels (a server's, the ones the user
    can read), newest first."""
    rows = await session.scalars(
        select(Message)
        .join(Channel, Channel.id == Message.channel_id)
        .outerjoin(ChannelRead, _with_read_marker(user_id))
        .where(Channel.id.in_(channel_ids), Channel.type == ChannelType.text, _unread_messages(user_id))
        .order_by(Message.id.desc())
        .limit(limit)
    )
    return list(rows)


async def mark_read(
    session: AsyncSession, user_id: uuid.UUID, channel_id: uuid.UUID, message_id: int | None
) -> tuple[int, int]:
    """Moves the read marker forward (never back) and clears mentions. Without a message id,
    marks everything read. Returns (last_read_message_id, unread_count). Not committed."""
    latest = await session.scalar(select(func.max(Message.id)).where(Message.channel_id == channel_id)) or 0
    target = latest if message_id is None else min(message_id, latest)
    last_read = await session.scalar(
        insert(ChannelRead)
        .values(user_id=user_id, channel_id=channel_id, last_read_message_id=target, mention_count=0)
        .on_conflict_do_update(
            index_elements=[ChannelRead.user_id, ChannelRead.channel_id],
            set_={
                "last_read_message_id": func.greatest(ChannelRead.last_read_message_id, target),
                "mention_count": 0,
            },
        )
        .returning(ChannelRead.last_read_message_id)
    )
    assert last_read is not None
    unread = await session.scalar(
        select(func.count(Message.id)).where(
            Message.channel_id == channel_id,
            Message.id > last_read,
            or_(Message.author_id.is_(None), Message.author_id != user_id),
        )
    )
    return last_read, unread or 0


async def mark_unread(session: AsyncSession, user_id: uuid.UUID, channel_id: uuid.UUID, message_id: int) -> tuple[int, int]:
    """"Marcar como não lida": moves the read marker back to just before the message (the only
    way it goes back). Mentions stay as they are. Returns (last_read_message_id, unread_count).
    Not committed."""
    target = (
        await session.scalar(
            select(func.max(Message.id)).where(Message.channel_id == channel_id, Message.id < message_id)
        )
        or 0
    )
    await session.execute(
        insert(ChannelRead)
        .values(user_id=user_id, channel_id=channel_id, last_read_message_id=target)
        .on_conflict_do_update(
            index_elements=[ChannelRead.user_id, ChannelRead.channel_id],
            set_={"last_read_message_id": target},
        )
    )
    unread = await session.scalar(
        select(func.count(Message.id)).where(
            Message.channel_id == channel_id,
            Message.id > target,
            or_(Message.author_id.is_(None), Message.author_id != user_id),
        )
    )
    return target, unread or 0
