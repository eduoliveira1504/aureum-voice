"""DMs and group DMs. Messages go through the regular /channels/{id}/messages routes.

Only friends can start a DM, create a group with someone or add them to one.
"""

import uuid

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import dms, reads, social
from app.access import channel_member_ids
from app.deps import CurrentUser, SessionDep
from app.models import Channel, ChannelMember, ChannelType
from app.realtime import broker
from app.schemas import MAX_GROUP_MEMBERS, DmCreate, DmOut, GroupCreate, GroupMembersAdd, GroupUpdate

router = APIRouter(prefix="/dms", tags=["dms"])


async def _require_friends(session: AsyncSession, user_id: uuid.UUID, others: list[uuid.UUID]) -> None:
    friends = await social.friend_ids(session, user_id)
    if any(o not in friends for o in others):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can only do this with your friends")


async def _my_dm(session: AsyncSession, channel_id: uuid.UUID, user_id: uuid.UUID) -> tuple[Channel, ChannelMember]:
    channel = await session.get(Channel, channel_id)
    membership = await session.get(ChannelMember, (channel_id, user_id))
    if channel is None or membership is None or channel.type not in dms.DM_TYPES:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return channel, membership


def _require_group(channel: Channel) -> None:
    if channel.type != ChannelType.group_dm:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Only groups can do this")


@router.get("", response_model=list[DmOut])
async def list_dms(user: CurrentUser, session: SessionDep) -> list[DmOut]:
    return await dms.list_for(session, user.id)


@router.post("", response_model=DmOut, status_code=status.HTTP_201_CREATED)
async def open_dm(body: DmCreate, user: CurrentUser, session: SessionDep, response: Response) -> DmOut:
    """Opens the DM with a friend, creating it the first time. It only shows up for the friend
    once something is sent in it."""
    if body.user_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="That's you")
    await _require_friends(session, user.id, [body.user_id])
    key = dms.dm_key(user.id, body.user_id)
    channel = await session.scalar(select(Channel).where(Channel.dm_key == key))
    if channel is not None:
        membership = await session.get(ChannelMember, (channel.id, user.id))
        assert membership is not None
        response.status_code = status.HTTP_200_OK
        if not membership.hidden:
            return await dms.load(session, channel, user.id)
        membership.hidden = False
    else:
        channel = Channel(type=ChannelType.dm, dm_key=key)
        session.add(channel)
        await session.flush()
        session.add(ChannelMember(channel_id=channel.id, user_id=user.id))
        session.add(ChannelMember(channel_id=channel.id, user_id=body.user_id, hidden=True))
    try:
        await session.commit()
    except IntegrityError:  # both opened it at the same moment: theirs exists now, open that one
        await session.rollback()
        return await open_dm(body, user, session, response)
    out = await dms.load(session, channel, user.id)
    await broker.publish("dm.created", out.model_dump(mode="json"), [user.id])
    return out


@router.post("/groups", response_model=DmOut, status_code=status.HTTP_201_CREATED)
async def create_group(body: GroupCreate, user: CurrentUser, session: SessionDep) -> DmOut:
    others = list(dict.fromkeys(u for u in body.user_ids if u != user.id))
    if not others:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Pick at least one friend")
    await _require_friends(session, user.id, others)
    channel = Channel(type=ChannelType.group_dm, name=body.name)
    session.add(channel)
    await session.flush()
    for user_id in [user.id, *others]:
        session.add(ChannelMember(channel_id=channel.id, user_id=user_id))
    await session.commit()
    await dms.announce(session, channel, [user.id, *others], "dm.created")
    return await dms.load(session, channel, user.id)


@router.patch("/{channel_id}", response_model=DmOut)
async def rename_group(channel_id: uuid.UUID, body: GroupUpdate, user: CurrentUser, session: SessionDep) -> DmOut:
    channel, _ = await _my_dm(session, channel_id, user.id)
    _require_group(channel)
    channel.name = body.name
    await session.commit()
    await dms.announce(session, channel, await channel_member_ids(session, channel.id))
    return await dms.load(session, channel, user.id)


@router.post("/{channel_id}/members", response_model=DmOut)
async def add_group_members(channel_id: uuid.UUID, body: GroupMembersAdd, user: CurrentUser, session: SessionDep) -> DmOut:
    channel, _ = await _my_dm(session, channel_id, user.id)
    _require_group(channel)
    # Lock the channel row so two concurrent adds can't push the group past its limit.
    await session.scalar(select(Channel.id).where(Channel.id == channel.id).with_for_update())
    current = await channel_member_ids(session, channel.id)
    new = [u for u in dict.fromkeys(body.user_ids) if u not in current]
    if not new:
        return await dms.load(session, channel, user.id)
    await _require_friends(session, user.id, new)
    if len(current) + len(new) > MAX_GROUP_MEMBERS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Groups hold up to {MAX_GROUP_MEMBERS} people")
    for user_id in new:
        session.add(ChannelMember(channel_id=channel.id, user_id=user_id))
        await reads.seed_channel(session, user_id, channel.id)
    await session.commit()
    await dms.announce(session, channel, new, "dm.created")
    await dms.announce(session, channel, current)
    return await dms.load(session, channel, user.id)


@router.delete("/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def close_or_leave(channel_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    """Closes a 1:1 DM (it reopens with the next message) or leaves a group. A group is deleted
    when its last member leaves."""
    channel, membership = await _my_dm(session, channel_id, user.id)
    if channel.type == ChannelType.dm:
        membership.hidden = True
        await session.commit()
    else:
        await session.delete(membership)
        await session.flush()
        remaining = await session.scalar(select(func.count()).where(ChannelMember.channel_id == channel.id))
        if not remaining:
            await session.delete(channel)
        await session.commit()
        if remaining:
            await dms.announce(session, channel, await channel_member_ids(session, channel.id))
    await broker.publish("dm.deleted", {"id": str(channel_id)}, [user.id])
    return Response(status_code=status.HTTP_204_NO_CONTENT)
