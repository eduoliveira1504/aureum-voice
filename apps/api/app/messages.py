"""Chats and posting in them: what the message routes and the addons that live in a chat
(polls) share."""

import uuid
from collections.abc import Callable, Sequence
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import attachments, dms, link_previews, reads, social
from app.access import channel_audience, channel_member_ids, get_channel_access
from app.models import Channel, ChannelType, Message
from app.permissions import ServerAccess
from app.realtime import broker
from app.schemas import MessageOut

# Older apps show this text as it comes, so it says what to do.
READ_ONLY = "Esta conversa é só de leitura. Atualize o app."


async def chat_channel(
    session: AsyncSession, channel_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[Channel, ServerAccess | None]:
    """A channel that holds messages: a server text channel, a DM or a group."""
    channel, access = await get_channel_access(session, channel_id, user_id)
    if channel.type not in (ChannelType.text, *dms.DM_TYPES):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Not a text channel")
    return channel, access


async def require_dm_friends(session: AsyncSession, channel: Channel, user_id: uuid.UUID) -> None:
    """A 1:1 DM stays readable after an unfriend or a block, but only friends can write. The
    official DM (app/bot) is read-only for everyone."""
    if channel.is_official:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=READ_ONLY)
    if channel.type != ChannelType.dm:
        return
    other = next(u for u in await channel_member_ids(session, channel.id) if u != user_id)
    if not await social.are_friends(session, user_id, other):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can only message your friends")


async def reply_target(session: AsyncSession, channel: Channel, message_id: int | None) -> Message | None:
    """The message a new one answers: one of this channel's people messages (not a call line or
    an addon's line)."""
    if message_id is None:
        return None
    original = await session.get(Message, message_id)
    if original is None or original.channel_id != channel.id or original.call_id is not None or original.system is not None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="You can only reply to a message of this conversation")
    return original


async def post_message(
    session: AsyncSession,
    channel: Channel,
    author_id: uuid.UUID | None,
    content: str,
    *,
    attachment_ids: Sequence[uuid.UUID] = (),
    embed: dict[str, Any] | None = None,
    system: dict[str, Any] | None = None,
    reply_to: Message | None = None,
    mention_reply: bool = False,
    forwarded_from: dict[str, Any] | None = None,
    previews: list[dict[str, Any]] | None = None,
    sticker: dict[str, Any] | None = None,
    gif: dict[str, Any] | None = None,
    on_saved: Callable[[Message], None] | None = None,
) -> MessageOut:
    """Saves the message, commits and sends it live. Permissions are the caller's job, and so is
    checking `reply_to` (see reply_target). `mention_reply` counts as a mention of its author.
    `on_saved` runs once the message has its id, before the commit (an addon links its row).
    People's messages get their links' cards a moment later (app/link_previews.py), unless
    `previews` gives them (a forward carries the original's)."""
    if channel.server_id is None:
        # Reopens the DM for whoever closed it, before the message exists: their read state
        # then doesn't count it yet, and message.created counts it once.
        await dms.reveal(session, channel)
    message = Message(
        channel_id=channel.id,
        author_id=author_id,
        content=content,
        attachments=[],
        embed=embed,
        system=system,
        reply_to_id=reply_to.id if reply_to else None,
        forwarded_from=forwarded_from,
        link_previews=previews or [],
        sticker=sticker,
        gif=gif,
    )
    session.add(message)
    await session.flush()
    if attachment_ids:
        assert author_id is not None
        await attachments.attach(session, message, list(attachment_ids), author_id)
    if on_saved is not None:
        on_saved(message)
    audience = await channel_audience(session, channel)
    # In DMs every message is for everyone in it; @mentions only matter in servers.
    also = reply_to.author_id if reply_to is not None and mention_reply else None
    mentioned = await reads.record_mentions(session, message, audience, also) if channel.server_id and system is None else []
    await session.commit()
    await session.refresh(message, ["author", "reply_to"])
    out = MessageOut.model_validate(message)
    # `mentions` rides along in the event only, so clients can bump their mention badges live.
    event = {
        **out.model_dump(mode="json"),
        "server_id": str(channel.server_id) if channel.server_id else None,
        "mentions": [str(u) for u in mentioned],
    }
    await broker.publish("message.created", event, audience)
    if author_id is not None and system is None and embed is None and sticker is None and gif is None and previews is None:
        link_previews.schedule(message.id, content)
    return out
