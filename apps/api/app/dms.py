"""Direct messages: 1:1 DMs (one per pair of friends) and group DMs (up to 10 people).

They are ordinary channels without a server (server_id NULL), with their members in
channel_members. A member can close a 1:1 DM from their list (hidden); it comes back as soon
as a message or a call arrives in it.
"""

import uuid

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import reads, voice
from app.models import Channel, ChannelMember, ChannelType, Message
from app.realtime import broker
from app.schemas import CallOut, DmMemberOut, DmOut, ReadStateOut, UserPublic

DM_TYPES = (ChannelType.dm, ChannelType.group_dm)


def dm_key(a: uuid.UUID, b: uuid.UUID) -> str:
    low, high = sorted([str(a), str(b)])
    return f"{low}:{high}"


async def _build(session: AsyncSession, channels: list[Channel], viewer: uuid.UUID) -> list[DmOut]:
    from app import calls  # calls builds on this module

    if not channels:
        return []
    ids = [c.id for c in channels]
    members = list(await session.scalars(select(ChannelMember).where(ChannelMember.channel_id.in_(ids))))
    online = await broker.online({m.user_id for m in members})
    rows = await session.execute(
        select(Message.channel_id, func.max(Message.id)).where(Message.channel_id.in_(ids)).group_by(Message.channel_id)
    )
    latest = {channel_id: last for channel_id, last in rows}
    states = await reads.channel_states(session, viewer, ids)
    active = await calls.current_calls(session, ids)
    out = []
    for channel in channels:
        _, last_read, unread, mentions = states[channel.id]
        call = active.get(channel.id)
        out.append(
            DmOut(
                id=channel.id,
                type=channel.type,
                name=channel.name,
                members=[
                    DmMemberOut(user=UserPublic.model_validate(m.user), online=m.user_id in online)
                    for m in sorted(members, key=lambda m: m.joined_at)
                    if m.channel_id == channel.id
                ],
                last_message_id=latest.get(channel.id, 0),
                read=ReadStateOut(channel_id=channel.id, last_read_message_id=last_read, unread_count=unread, mention_count=mentions),
                call=CallOut.model_validate(call) if call else None,
                voice_states=await voice.get_states(voice.dm_scope(channel.id)) if call else [],
            )
        )
    return out


async def load(session: AsyncSession, channel: Channel, viewer: uuid.UUID) -> DmOut:
    return (await _build(session, [channel], viewer))[0]


async def list_for(session: AsyncSession, user_id: uuid.UUID) -> list[DmOut]:
    """The user's open conversations, latest activity first."""
    channels = list(
        await session.scalars(
            select(Channel)
            .join(ChannelMember, ChannelMember.channel_id == Channel.id)
            .where(ChannelMember.user_id == user_id, ChannelMember.hidden.is_(False))
        )
    )
    dms = await _build(session, channels, user_id)
    return sorted(dms, key=lambda d: d.last_message_id, reverse=True)


async def announce(session: AsyncSession, channel: Channel, user_ids: list[uuid.UUID], type_: str = "dm.updated") -> None:
    """Sends each user their own view of the conversation (the read state differs per user)."""
    for user_id in user_ids:
        out = await load(session, channel, user_id)
        await broker.publish(type_, out.model_dump(mode="json"), [user_id])


async def reveal(session: AsyncSession, channel: Channel) -> None:
    """Reopens the conversation for members who closed it (a message or call arrived) and
    sends it to them as dm.created. Commits."""
    rows = await session.scalars(
        update(ChannelMember)
        .where(ChannelMember.channel_id == channel.id, ChannelMember.hidden.is_(True))
        .values(hidden=False)
        .returning(ChannelMember.user_id)
    )
    reopened = list(rows)
    await session.commit()
    await announce(session, channel, reopened, "dm.created")
