import uuid
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import attachments, calls, dms, forwarding, media, reads, social, voice
from app.access import channel_audience, channel_member_ids, get_channel_access, get_channel_for_member
from app.addons import registry as addons
from app.config import get_settings
from app.deps import CurrentUser, SessionDep
from app.messages import chat_channel, post_message, reply_target, require_dm_friends
from app.models import Channel, ChannelOverride, ChannelRead, ChannelType, Message, OverrideTarget, Role, ServerMember
from app.permissions import CHANNEL_PERMS, Perm, ServerAccess, channel_overwrites, channel_viewers
from app.realtime import broker
from app.routers.servers import channel_out, normalize_channel_name, permissions_changed
from app.schemas import (
    ChannelOut,
    AttachmentOut,
    ChannelUpdate,
    ForwardCreate,
    MarkRead,
    MarkUnread,
    MessageCreate,
    MessageEdit,
    MessageOut,
    OverrideSet,
    ReadStateOut,
    VoiceTokenOut,
)

router = APIRouter(tags=["channels"])


# --- Channels -------------------------------------------------------------------


@router.patch("/channels/{channel_id}", response_model=ChannelOut)
async def update_channel(channel_id: uuid.UUID, body: ChannelUpdate, user: CurrentUser, session: SessionDep) -> ChannelOut:
    channel, access = await get_channel_for_member(session, channel_id, user.id)
    addon_fields = body.model_fields_set & {"config", "announce_channel_id"}
    # Renaming and moving are channel management; an addon's settings only need MANAGE_ADDONS.
    if body.name is not None or body.position is not None or not addon_fields:
        access.require_in(channel, Perm.MANAGE_CHANNELS)
    if body.name is not None:
        channel.name = normalize_channel_name(body.name, channel.type)
    if body.position is not None:
        channel.position = body.position
    if addon_fields:
        if channel.type != ChannelType.addon:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Only addon channels have settings")
        access.require_in(channel, Perm.MANAGE_ADDONS)
        addon = addons.get_addon(channel.addon_key)
        if addon is None:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="This addon is no longer available")
        if body.config is not None:
            channel.config = addon.parse_config(body.config)
        if "announce_channel_id" in addon_fields:
            if body.announce_channel_id is not None and not addon.announces:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="This addon doesn't post to a chat")
            await _check_announce_channel(session, channel, body.announce_channel_id, body.confirm_wider_audience, user.id)
            channel.announce_channel_id = body.announce_channel_id
    await session.commit()
    out = channel_out(channel, (await channel_overwrites(session, [channel.id]))[channel.id])
    await broker.publish("channel.updated", out.model_dump(mode="json"), await channel_viewers(session, channel))
    return out


async def _check_announce_channel(
    session: AsyncSession, channel: Channel, target_id: uuid.UUID | None, confirmed: bool, user_id: uuid.UUID
) -> None:
    """The announce channel must be a text channel of the same server that the user can see.
    Picking one that people who can't see the addon channel can see needs a confirmation (409
    "wider_audience" until then): they'd read what the addon posts there."""
    if target_id is None or target_id == channel.announce_channel_id:
        return
    target, _ = await get_channel_for_member(session, target_id, user_id)
    if target.server_id != channel.server_id or target.type != ChannelType.text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Pick a text channel of this server")
    if confirmed:
        return
    outside = set(await channel_viewers(session, target)) - set(await channel_viewers(session, channel))
    if outside:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "wider_audience",
                "message": "People who can't see this addon channel can see the announce channel",
                "count": len(outside),
            },
        )


@router.delete("/channels/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(channel_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    channel, access = await get_channel_for_member(session, channel_id, user.id)
    access.require_in(channel, Perm.MANAGE_CHANNELS)
    files: list[str] = []
    if channel.type == ChannelType.addon:
        # Deleting an addon channel also deletes the addon's data in it.
        access.require_in(channel, Perm.MANAGE_ADDONS)
        files += await addons.cleanup(session, [(channel.addon_key, channel.id)])
    server_id = channel.server_id
    assert server_id is not None
    recipients = await channel_viewers(session, channel)
    files += await attachments.keys_of_channels(session, [channel.id])
    await session.delete(channel)
    await session.commit()
    await attachments.delete_keys(session, files)
    await voice.clear_channel(server_id, channel_id, recipients)
    await broker.publish("channel.deleted", {"id": str(channel_id), "server_id": str(server_id)}, recipients)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Voice ----------------------------------------------------------------------


@router.post("/channels/{channel_id}/voice/token", response_model=VoiceTokenOut)
async def voice_token(channel_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> VoiceTokenOut:
    """For a server voice channel, or for the call in progress in a DM/group."""
    channel, access = await get_channel_access(session, channel_id, user.id)
    sources = None
    can_subscribe = True
    if channel.type in dms.DM_TYPES:
        if await calls.current_call(session, channel.id) is None:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="No call in progress")
    elif channel.type != ChannelType.voice:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Not a voice channel")
    else:
        assert access is not None
        member = await session.get(ServerMember, (channel.server_id, user.id))
        assert member is not None
        sources = moderated_sources(voice_sources(access.channel(channel)), member)
        can_subscribe = not member.voice_deafened
    token = voice.livekit_token(
        room=str(channel.id), identity=str(user.id), name=user.display_name, sources=sources, can_subscribe=can_subscribe
    )
    return VoiceTokenOut(token=token, url=get_settings().livekit_url, media=media.tier_for(user.plan))


def voice_sources(perms: Perm) -> list[str]:
    """What the user may publish in a server room (403 without CONNECT). LiveKit enforces it."""
    if not perms & Perm.CONNECT:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can't join this room")
    sources = []
    if perms & Perm.SPEAK:
        sources.append(voice.SOURCE_MIC)
    if perms & Perm.VIDEO:
        sources.append(voice.SOURCE_CAMERA)
    if perms & Perm.STREAM:
        sources.extend(voice.SOURCE_SCREEN)
    return sources


def moderated_sources(sources: list[str], member: ServerMember) -> list[str]:
    """A server mute or deafen also takes the mic away."""
    if member.voice_muted or member.voice_deafened:
        return [s for s in sources if s != voice.SOURCE_MIC]
    return sources


# --- Messages -------------------------------------------------------------------


def _server_id(channel: Channel) -> str | None:
    return str(channel.server_id) if channel.server_id else None


@router.post("/channels/{channel_id}/attachments", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    channel_id: uuid.UUID,
    file: Annotated[UploadFile, File(description="Any file, up to MAX_ATTACHMENT_MB")],
    user: CurrentUser,
    session: SessionDep,
    voice: Annotated[bool, Form()] = False,
    duration_ms: Annotated[int | None, Form()] = None,
    waveform: Annotated[str | None, Form(max_length=1000)] = None,
) -> dict:
    """Uploads a file for a message about to be sent here (attachment_ids of the message).
    `voice` marks a voice message recorded in the app, with its duration and waveform."""
    channel, access = await chat_channel(session, channel_id, user.id)
    await require_dm_friends(session, channel, user.id)
    if access is not None:
        needed = Perm.SEND_MESSAGES | Perm.ATTACH_FILES
        if access.channel(channel) & needed != needed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can't send files here")
    meta = attachments.voice_meta(duration_ms, waveform) if voice else None
    return attachments.out(await attachments.upload(session, channel, user.id, file, voice=meta))


@router.get("/channels/{channel_id}/messages", response_model=list[MessageOut])
async def list_messages(
    channel_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
    before: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[Message]:
    """Newest page first; messages inside the page are in chronological order. Without
    READ_HISTORY the page is empty: only messages that arrive live are seen."""
    channel, access = await chat_channel(session, channel_id, user.id)
    if access is not None and not access.channel(channel) & Perm.READ_HISTORY:
        return []
    query = select(Message).where(Message.channel_id == channel_id)
    if before is not None:
        query = query.where(Message.id < before)
    rows = await session.scalars(query.order_by(Message.id.desc()).limit(limit))
    return list(reversed(list(rows)))


@router.post("/channels/{channel_id}/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
async def create_message(channel_id: uuid.UUID, body: MessageCreate, user: CurrentUser, session: SessionDep) -> MessageOut:
    channel, access = await chat_channel(session, channel_id, user.id)
    await require_dm_friends(session, channel, user.id)
    if access is not None:
        access.require_in(channel, Perm.SEND_MESSAGES)
    if body.attachment_ids and access is not None:
        access.require_in(channel, Perm.ATTACH_FILES)
    reply_to = await reply_target(session, channel, body.reply_to_id)
    return await post_message(
        session,
        channel,
        user.id,
        body.content,
        attachment_ids=body.attachment_ids,
        reply_to=reply_to,
        mention_reply=body.mention_reply,
    )


@router.post("/channels/{channel_id}/read", response_model=ReadStateOut)
async def mark_read(channel_id: uuid.UUID, user: CurrentUser, session: SessionDep, body: MarkRead | None = None) -> ReadStateOut:
    channel, _ = await chat_channel(session, channel_id, user.id)
    last_read, unread = await reads.mark_read(session, user.id, channel_id, body.message_id if body else None)
    await session.commit()
    out = ReadStateOut(channel_id=channel_id, last_read_message_id=last_read, unread_count=unread, mention_count=0)
    # The user's other devices clear their badges too.
    await broker.publish("read.updated", {**out.model_dump(mode="json"), "server_id": _server_id(channel)}, [user.id])
    return out


@router.post("/channels/{channel_id}/unread", response_model=ReadStateOut)
async def mark_unread(channel_id: uuid.UUID, body: MarkUnread, user: CurrentUser, session: SessionDep) -> ReadStateOut:
    """"Marcar como não lida" on a message: it and what came after count as unread again."""
    channel, _ = await chat_channel(session, channel_id, user.id)
    message = await session.get(Message, body.message_id)
    if message is None or message.channel_id != channel_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Message not found")
    last_read, unread = await reads.mark_unread(session, user.id, channel_id, body.message_id)
    await session.commit()
    mentions = await session.scalar(
        select(ChannelRead.mention_count).where(ChannelRead.user_id == user.id, ChannelRead.channel_id == channel_id)
    )
    out = ReadStateOut(channel_id=channel_id, last_read_message_id=last_read, unread_count=unread, mention_count=mentions or 0)
    await broker.publish("read.updated", {**out.model_dump(mode="json"), "server_id": _server_id(channel)}, [user.id])
    return out


@router.post("/messages/{message_id}/forward", response_model=list[MessageOut], status_code=status.HTTP_201_CREATED)
async def forward_message(message_id: int, body: ForwardCreate, user: CurrentUser, session: SessionDep) -> list[MessageOut]:
    """"Encaminhar": a copy of the message in up to 5 conversations the user can write in."""
    return await forwarding.forward(session, user.id, message_id, body.channel_ids, body.comment)


async def _message_for_member(
    session: AsyncSession, message_id: int, user_id: uuid.UUID
) -> tuple[Message, Channel, ServerAccess | None]:
    message = await session.get(Message, message_id)
    if message is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Message not found")
    channel, access = await get_channel_access(session, message.channel_id, user_id)
    return message, channel, access


@router.patch("/messages/{message_id}", response_model=MessageOut)
async def edit_message(message_id: int, body: MessageEdit, user: CurrentUser, session: SessionDep) -> MessageOut:
    message, channel, _ = await _message_for_member(session, message_id, user.id)
    if message.author_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can only edit your own messages")
    if message.call_id is not None or message.system is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="System lines can't be edited")
    if message.embed is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="This message is edited in its addon")
    message.content = body.content
    message.edited_at = func.now()
    await session.commit()
    await session.refresh(message)
    out = MessageOut.model_validate(message)
    await broker.publish("message.updated", out.model_dump(mode="json"), await channel_audience(session, channel))
    return out


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(message_id: int, user: CurrentUser, session: SessionDep) -> Response:
    message, channel, access = await _message_for_member(session, message_id, user.id)
    # In DMs nobody moderates: only the author deletes.
    if message.author_id != user.id and (access is None or not access.channel(channel) & Perm.MANAGE_MESSAGES):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can't delete this message")
    channel_id = message.channel_id
    files = await attachments.keys_of_messages(session, [message_id])
    await session.delete(message)
    await session.commit()
    await attachments.delete_keys(session, files)
    await broker.publish(
        "message.deleted",
        {"id": message_id, "channel_id": str(channel_id)},
        await channel_audience(session, channel),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Permission overrides -------------------------------------------------------


async def _check_override(
    session: AsyncSession,
    channel: Channel,
    access: ServerAccess,
    target_type: OverrideTarget,
    target_id: uuid.UUID,
    changed: int,
) -> None:
    """Needs MANAGE_ROLES in the channel, a target in the server that ranks below the editor,
    and only bits the editor has there."""
    access.require_in(channel, Perm.MANAGE_ROLES)
    if target_type == OverrideTarget.role:
        role = await session.get(Role, target_id)
        if role is None or role.server_id != channel.server_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Role not found")
        if not role.is_everyone:
            access.require_outranks(role.position, "this role")
    else:
        if await session.get(ServerMember, (channel.server_id, target_id)) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Member not found")
        access.require_outranks(access.ctx.rank(target_id), "this member")
    access.require_grantable(changed, within=access.channel(channel))


async def _overrides_changed(session: AsyncSession, channel: Channel) -> ChannelOut:
    assert channel.server_id is not None
    await permissions_changed(session, channel.server_id)
    return channel_out(channel, (await channel_overwrites(session, [channel.id]))[channel.id])


@router.put("/channels/{channel_id}/overrides/{target_type}/{target_id}", response_model=ChannelOut)
async def set_override(
    channel_id: uuid.UUID,
    target_type: OverrideTarget,
    target_id: uuid.UUID,
    body: OverrideSet,
    user: CurrentUser,
    session: SessionDep,
) -> ChannelOut:
    """Sets what a role (@everyone's id is the server's) or a member may do in this channel."""
    channel, access = await get_channel_for_member(session, channel_id, user.id)
    if body.allow & body.deny:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A permission can't be both allowed and denied")
    if (body.allow | body.deny) & ~int(CHANNEL_PERMS):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Only channel permissions can be overridden")
    current = await session.get(ChannelOverride, (channel_id, target_type, target_id))
    old_allow, old_deny = (current.allow, current.deny) if current else (0, 0)
    changed = (body.allow ^ old_allow) | (body.deny ^ old_deny)
    await _check_override(session, channel, access, target_type, target_id, changed)
    await session.execute(
        insert(ChannelOverride)
        .values(channel_id=channel_id, target_type=target_type, target_id=target_id, allow=body.allow, deny=body.deny)
        .on_conflict_do_update(
            index_elements=[ChannelOverride.channel_id, ChannelOverride.target_type, ChannelOverride.target_id],
            set_={"allow": body.allow, "deny": body.deny},
        )
    )
    await session.commit()
    return await _overrides_changed(session, channel)


@router.delete("/channels/{channel_id}/overrides/{target_type}/{target_id}", response_model=ChannelOut)
async def remove_override(
    channel_id: uuid.UUID, target_type: OverrideTarget, target_id: uuid.UUID, user: CurrentUser, session: SessionDep
) -> ChannelOut:
    channel, access = await get_channel_for_member(session, channel_id, user.id)
    override = await session.get(ChannelOverride, (channel_id, target_type, target_id))
    if override is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Override not found")
    await _check_override(session, channel, access, target_type, target_id, override.allow | override.deny)
    await session.delete(override)
    await session.commit()
    return await _overrides_changed(session, channel)
