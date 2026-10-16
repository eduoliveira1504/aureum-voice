import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import dms, reads, social, voice
from app.access import (
    MANAGERS,
    channel_audience,
    channel_member_ids,
    get_channel_access,
    get_channel_for_member,
    require_manager,
    server_member_ids,
)
from app.config import get_settings
from app.deps import CurrentUser, SessionDep
from app.models import Channel, ChannelType, Message, ServerMember
from app.realtime import broker
from app.routers.servers import normalize_channel_name
from app.schemas import (
    ChannelOut,
    ChannelUpdate,
    MarkRead,
    MessageCreate,
    MessageOut,
    ReadStateOut,
    VoiceTokenOut,
)

router = APIRouter(tags=["channels"])


# --- Channels -------------------------------------------------------------------


@router.patch("/channels/{channel_id}", response_model=ChannelOut)
async def update_channel(channel_id: uuid.UUID, body: ChannelUpdate, user: CurrentUser, session: SessionDep) -> ChannelOut:
    channel, member = await get_channel_for_member(session, channel_id, user.id)
    require_manager(member)
    if body.name is not None:
        channel.name = normalize_channel_name(body.name, channel.type)
    if body.position is not None:
        channel.position = body.position
    await session.commit()
    out = ChannelOut.model_validate(channel)
    assert channel.server_id is not None
    await broker.publish("channel.updated", out.model_dump(mode="json"), await server_member_ids(session, channel.server_id))
    return out


@router.delete("/channels/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(channel_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    channel, member = await get_channel_for_member(session, channel_id, user.id)
    require_manager(member)
    server_id = channel.server_id
    assert server_id is not None
    await session.delete(channel)
    await session.commit()
    recipients = await server_member_ids(session, server_id)
    await voice.clear_channel(server_id, channel_id, recipients)
    await broker.publish("channel.deleted", {"id": str(channel_id), "server_id": str(server_id)}, recipients)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Voice ----------------------------------------------------------------------


@router.post("/channels/{channel_id}/voice/token", response_model=VoiceTokenOut)
async def voice_token(channel_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> VoiceTokenOut:
    channel, _ = await get_channel_for_member(session, channel_id, user.id)
    if channel.type != ChannelType.voice:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Not a voice channel")
    token = voice.livekit_token(room=str(channel.id), identity=str(user.id), name=user.display_name)
    return VoiceTokenOut(token=token, url=get_settings().livekit_url)


# --- Messages -------------------------------------------------------------------


def _server_id(channel: Channel) -> str | None:
    return str(channel.server_id) if channel.server_id else None


async def _text_channel(
    session: AsyncSession, channel_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[Channel, ServerMember | None]:
    """A channel that holds messages: a server text channel, a DM or a group."""
    channel, member = await get_channel_access(session, channel_id, user_id)
    if channel.type not in (ChannelType.text, *dms.DM_TYPES):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Not a text channel")
    return channel, member


async def _require_dm_friends(session: AsyncSession, channel: Channel, user_id: uuid.UUID) -> None:
    """A 1:1 DM stays readable after an unfriend or a block, but only friends can write."""
    if channel.type != ChannelType.dm:
        return
    other = next(u for u in await channel_member_ids(session, channel.id) if u != user_id)
    if not await social.are_friends(session, user_id, other):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can only message your friends")


@router.get("/channels/{channel_id}/messages", response_model=list[MessageOut])
async def list_messages(
    channel_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
    before: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[Message]:
    """Newest page first; messages inside the page are in chronological order."""
    await _text_channel(session, channel_id, user.id)
    query = select(Message).where(Message.channel_id == channel_id)
    if before is not None:
        query = query.where(Message.id < before)
    rows = await session.scalars(query.order_by(Message.id.desc()).limit(limit))
    return list(reversed(list(rows)))


@router.post("/channels/{channel_id}/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
async def create_message(channel_id: uuid.UUID, body: MessageCreate, user: CurrentUser, session: SessionDep) -> MessageOut:
    channel, _ = await _text_channel(session, channel_id, user.id)
    await _require_dm_friends(session, channel, user.id)
    message = Message(channel_id=channel_id, author_id=user.id, content=body.content, attachments=[])
    session.add(message)
    await session.flush()
    # In DMs every message is for everyone in it; @mentions only matter in servers.
    mentioned = await reads.record_mentions(session, message, channel.server_id) if channel.server_id else []
    await session.commit()
    await session.refresh(message, ["author"])
    if channel.server_id is None:
        await dms.reveal(session, channel)  # before the message, so the conversation exists
    out = MessageOut.model_validate(message)
    # `mentions` rides along in the event only, so clients can bump their mention badges live.
    event = {**out.model_dump(mode="json"), "server_id": _server_id(channel), "mentions": [str(u) for u in mentioned]}
    await broker.publish("message.created", event, await channel_audience(session, channel))
    return out


@router.post("/channels/{channel_id}/read", response_model=ReadStateOut)
async def mark_read(channel_id: uuid.UUID, user: CurrentUser, session: SessionDep, body: MarkRead | None = None) -> ReadStateOut:
    channel, _ = await _text_channel(session, channel_id, user.id)
    last_read, unread = await reads.mark_read(session, user.id, channel_id, body.message_id if body else None)
    await session.commit()
    out = ReadStateOut(channel_id=channel_id, last_read_message_id=last_read, unread_count=unread, mention_count=0)
    # The user's other devices clear their badges too.
    await broker.publish("read.updated", {**out.model_dump(mode="json"), "server_id": _server_id(channel)}, [user.id])
    return out


async def _message_for_member(
    session: AsyncSession, message_id: int, user_id: uuid.UUID
) -> tuple[Message, Channel, ServerMember | None]:
    message = await session.get(Message, message_id)
    if message is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Message not found")
    channel, member = await get_channel_access(session, message.channel_id, user_id)
    return message, channel, member


@router.patch("/messages/{message_id}", response_model=MessageOut)
async def edit_message(message_id: int, body: MessageCreate, user: CurrentUser, session: SessionDep) -> MessageOut:
    message, channel, _ = await _message_for_member(session, message_id, user.id)
    if message.author_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can only edit your own messages")
    message.content = body.content
    message.edited_at = func.now()
    await session.commit()
    await session.refresh(message)
    out = MessageOut.model_validate(message)
    await broker.publish("message.updated", out.model_dump(mode="json"), await channel_audience(session, channel))
    return out


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(message_id: int, user: CurrentUser, session: SessionDep) -> Response:
    message, channel, member = await _message_for_member(session, message_id, user.id)
    # In DMs nobody moderates: only the author deletes.
    if message.author_id != user.id and (member is None or member.role not in MANAGERS):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can't delete this message")
    channel_id = message.channel_id
    await session.delete(message)
    await session.commit()
    await broker.publish(
        "message.deleted",
        {"id": message_id, "channel_id": str(channel_id)},
        await channel_audience(session, channel),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
