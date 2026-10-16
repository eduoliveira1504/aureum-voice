"""Membership and permission checks shared by the server, channel, DM and message routes."""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Channel, ChannelMember, ServerMember
from app.permissions import ServerAccess, channel_viewers, server_access
from app.social import friend_ids


async def get_membership(session: AsyncSession, server_id: uuid.UUID, user_id: uuid.UUID) -> ServerMember:
    """404 (not 403) for non-members, so server ids can't be probed."""
    member = await session.get(ServerMember, (server_id, user_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Server not found")
    return member


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail="Channel not found")


async def get_channel_for_member(
    session: AsyncSession, channel_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[Channel, ServerAccess]:
    """A server channel the user can see (DMs and hidden channels are 404 here)."""
    channel = await session.get(Channel, channel_id)
    if channel is None or channel.server_id is None:
        raise _not_found()
    return channel, await _viewable(session, channel, user_id)


async def _viewable(session: AsyncSession, channel: Channel, user_id: uuid.UUID) -> ServerAccess:
    assert channel.server_id is not None
    try:
        access = await server_access(session, channel.server_id, user_id, [channel.id])
    except HTTPException:
        raise _not_found() from None
    # A channel the user can't see doesn't exist for them.
    if not access.can_view(channel):
        raise _not_found()
    return access


async def get_channel_access(
    session: AsyncSession, channel_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[Channel, ServerAccess | None]:
    """Any channel the user can see: a server channel (with their permissions there) or a
    DM/group they're in (access None)."""
    channel = await session.get(Channel, channel_id)
    if channel is None:
        raise _not_found()
    if channel.server_id is not None:
        return channel, await _viewable(session, channel, user_id)
    if await session.get(ChannelMember, (channel_id, user_id)) is None:
        raise _not_found()
    return channel, None


async def server_member_ids(session: AsyncSession, server_id: uuid.UUID | None) -> list[uuid.UUID]:
    rows = await session.scalars(select(ServerMember.user_id).where(ServerMember.server_id == server_id))
    return list(rows)


async def channel_member_ids(session: AsyncSession, channel_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await session.scalars(select(ChannelMember.user_id).where(ChannelMember.channel_id == channel_id))
    return list(rows)


async def channel_audience(session: AsyncSession, channel: Channel) -> list[uuid.UUID]:
    """Who receives a channel's events: the server members who can see it, or the DM's members."""
    if channel.server_id is not None:
        return await channel_viewers(session, channel)
    return await channel_member_ids(session, channel.id)


async def audience_ids(session: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    """Everyone who sees the user somewhere (including the user): people sharing a server or a
    DM/group with them, and their friends. Profile and presence changes go to them."""
    my_servers = select(ServerMember.server_id).where(ServerMember.user_id == user_id)
    co_members = await session.scalars(
        select(ServerMember.user_id).where(ServerMember.server_id.in_(my_servers)).distinct()
    )
    my_dms = select(ChannelMember.channel_id).where(ChannelMember.user_id == user_id)
    dm_members = await session.scalars(
        select(ChannelMember.user_id).where(ChannelMember.channel_id.in_(my_dms)).distinct()
    )
    return list({*co_members, *dm_members, *await friend_ids(session, user_id), user_id})
