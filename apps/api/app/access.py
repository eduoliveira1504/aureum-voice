"""Membership and permission checks shared by the server, channel and message routes."""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Channel, MemberRole, ServerMember

MANAGERS = {MemberRole.owner, MemberRole.admin}


async def get_membership(session: AsyncSession, server_id: uuid.UUID, user_id: uuid.UUID) -> ServerMember:
    """404 (not 403) for non-members, so server ids can't be probed."""
    member = await session.get(ServerMember, (server_id, user_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Server not found")
    return member


def require_manager(member: ServerMember) -> None:
    if member.role not in MANAGERS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only owners and admins can do this")


async def get_channel_for_member(
    session: AsyncSession, channel_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[Channel, ServerMember]:
    channel = await session.get(Channel, channel_id)
    if channel is None or channel.server_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Channel not found")
    member = await session.get(ServerMember, (channel.server_id, user_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Channel not found")
    return channel, member


async def server_member_ids(session: AsyncSession, server_id: uuid.UUID | None) -> list[uuid.UUID]:
    rows = await session.scalars(select(ServerMember.user_id).where(ServerMember.server_id == server_id))
    return list(rows)


async def co_member_ids(session: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    """Everyone who shares at least one server with the user (including the user)."""
    my_servers = select(ServerMember.server_id).where(ServerMember.user_id == user_id)
    rows = await session.scalars(
        select(ServerMember.user_id).where(ServerMember.server_id.in_(my_servers)).distinct()
    )
    return list({*rows, user_id})
