"""Chats and posting in them: what the message routes and the addons that live in a chat
(polls) share."""

import uuid
from collections.abc import Sequence
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import attachments, dms, reads, social
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


async def post_message(
    session: AsyncSession,
    channel: Channel,
    author_id: uuid.UUID,
    content: str,
    *,
    attachment_ids: Sequence[uuid.UUID] = (),
    embed: dict[str, Any] | None = None,
    system: dict[str, Any] | None = None,
) -> MessageOut:
    """Saves the message, commits and sends it live. Permissions are the caller's job."""
    if channel.server_id is None:
        # Reopens the DM for whoever closed it, before the message exists: their read state
        # then doesn't count it yet, and message.created counts it once.
        await dms.reveal(session, channel)
    message = Message(channel_id=channel.id, author_id=author_id, content=content, attachments=[], embed=embed, system=system)
    session.add(message)
    await session.flush()
    await attachments.attach(session, message, list(attachment_ids), author_id)
    audience = await channel_audience(session, channel)
    # In DMs every message is for everyone in it; @mentions only matter in servers.
    mentioned = await reads.record_mentions(session, message, audience) if channel.server_id and system is None else []
    await session.commit()
    await session.refresh(message, ["author"])
    out = MessageOut.model_validate(message)
    # `mentions` rides along in the event only, so clients can bump their mention badges live.
    event = {
        **out.model_dump(mode="json"),
        "server_id": str(channel.server_id) if channel.server_id else None,
        "mentions": [str(u) for u in mentioned],
    }
    await broker.publish("message.created", event, audience)
    return out
