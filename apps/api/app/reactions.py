"""Emoji reactions under messages.

Anyone who can write in a conversation can react there, and in the official DM too. In a
server, starting a new emoji on a message takes ADD_REACTIONS, while adding to one already there
doesn't; MANAGE_MESSAGES removes other people's. Up to MAX_EMOJIS different emojis per message.
Changes go out live as "message.reactions" with the message's whole summary. Reactions don't
notify anyone.
"""

import unicodedata
import uuid
from collections.abc import Iterable

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.access import channel_audience, get_channel_access
from app.messages import require_dm_friends
from app.models import Channel, Message, MessageReaction
from app.permissions import Perm, ServerAccess
from app.realtime import broker
from app.schemas import ReactionOut

MAX_EMOJIS = 20
# A single emoji, even a long ZWJ family with skin tones, stays well under this many code points.
MAX_CODEPOINTS = 16


# Joiners and modifiers that are part of an emoji: ZWJ, the emoji look, and the tag characters of
# subdivision flags (🏴 England).
_PARTS = {"‍", "️"} | {chr(c) for c in range(0xE0020, 0xE0080)}


def valid_emoji(emoji: str) -> bool:
    """A loose check that `emoji` is one emoji and not text: short, no spaces, letters or other
    control characters, and a symbol outside ASCII (or a keycap, like 1️⃣). The app only sends
    emojis from its picker; this keeps anything else out of the summary everyone sees."""
    if not 0 < len(emoji) <= MAX_CODEPOINTS:
        return False
    if any(c not in _PARTS and unicodedata.category(c)[0] in ("C", "L", "Z") for c in emoji):
        return False
    return "⃣" in emoji or any(ord(c) > 0x7F and unicodedata.category(c) == "So" for c in emoji)


async def summaries(session: AsyncSession, message_ids: Iterable[int]) -> dict[int, list[ReactionOut]]:
    """Each message's reactions: emoji, count and who, in the order they were first used."""
    ids = list(message_ids)
    if not ids:
        return {}
    rows = await session.execute(
        select(MessageReaction.message_id, MessageReaction.emoji, MessageReaction.user_id)
        .where(MessageReaction.message_id.in_(ids))
        .order_by(MessageReaction.created_at, MessageReaction.user_id)
    )
    grouped: dict[int, dict[str, list[uuid.UUID]]] = {}
    for message_id, emoji, user_id in rows:
        grouped.setdefault(message_id, {}).setdefault(emoji, []).append(user_id)
    return {
        message_id: [ReactionOut(emoji=e, count=len(users), user_ids=users) for e, users in by_emoji.items()]
        for message_id, by_emoji in grouped.items()
    }


async def _target(session: AsyncSession, message_id: int, user_id: uuid.UUID) -> tuple[Message, Channel, ServerAccess | None]:
    message = await session.get(Message, message_id)
    if message is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Message not found")
    channel, access = await get_channel_access(session, message.channel_id, user_id)
    if message.call_id is not None or message.system is not None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This line takes no reactions")
    return message, channel, access


async def _publish(session: AsyncSession, message: Message, channel: Channel) -> list[ReactionOut]:
    summary = (await summaries(session, [message.id])).get(message.id, [])
    await broker.publish(
        "message.reactions",
        {
            "message_id": message.id,
            "channel_id": str(channel.id),
            "server_id": str(channel.server_id) if channel.server_id else None,
            "reactions": [r.model_dump(mode="json") for r in summary],
        },
        await channel_audience(session, channel),
    )
    return summary


async def add(session: AsyncSession, message_id: int, user_id: uuid.UUID, emoji: str) -> list[ReactionOut]:
    if not valid_emoji(emoji):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Not an emoji")
    message, channel, access = await _target(session, message_id, user_id)
    if channel.server_id is None and not channel.is_official:
        await require_dm_friends(session, channel, user_id)  # a 1:1 DM: friends only, like writing
    emojis = set(await session.scalars(select(MessageReaction.emoji).where(MessageReaction.message_id == message.id).distinct()))
    if emoji not in emojis:
        if access is not None and not access.channel(channel) & Perm.ADD_REACTIONS:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can't add new reactions here")
        if len(emojis) >= MAX_EMOJIS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"At most {MAX_EMOJIS} different reactions")
    await session.execute(
        insert(MessageReaction).values(message_id=message.id, user_id=user_id, emoji=emoji).on_conflict_do_nothing()
    )
    await session.commit()
    return await _publish(session, message, channel)


async def remove(
    session: AsyncSession, message_id: int, user_id: uuid.UUID, emoji: str, whose: uuid.UUID | None = None
) -> list[ReactionOut]:
    """Takes back the user's reaction, or with `whose`, someone else's (MANAGE_MESSAGES)."""
    message, channel, access = await _target(session, message_id, user_id)
    if whose is not None and whose != user_id:
        if access is None or not access.channel(channel) & Perm.MANAGE_MESSAGES:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can't remove other people's reactions")
    await session.execute(
        delete(MessageReaction).where(
            MessageReaction.message_id == message.id,
            MessageReaction.user_id == (whose or user_id),
            MessageReaction.emoji == emoji,
        )
    )
    await session.commit()
    return await _publish(session, message, channel)
