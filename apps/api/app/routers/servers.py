import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import voice
from app.access import get_membership, require_manager, server_member_ids
from app.deps import CurrentUser, SessionDep
from app.models import Channel, ChannelType, Invite, MemberRole, Server, ServerMember
from app.realtime import broker
from app.schemas import (
    ChannelCreate,
    ChannelOut,
    InviteCreate,
    InviteOut,
    MemberOut,
    ServerCreate,
    ServerDetail,
    ServerOut,
    ServerUpdate,
)

router = APIRouter(tags=["servers"])

DEFAULT_CHANNELS = [("geral", ChannelType.text), ("Geral", ChannelType.voice)]


def normalize_channel_name(name: str, type_: ChannelType) -> str:
    # Text channels follow the familiar "lowercase-with-dashes" style.
    return "-".join(name.lower().split()) if type_ == ChannelType.text else name


async def load_detail(session: AsyncSession, server: Server) -> ServerDetail:
    channels = await session.scalars(
        select(Channel).where(Channel.server_id == server.id).order_by(Channel.position, Channel.name)
    )
    members = list(
        await session.scalars(
            select(ServerMember).where(ServerMember.server_id == server.id).order_by(ServerMember.joined_at)
        )
    )
    online = await broker.online(m.user_id for m in members)
    try:
        voice_states = await voice.get_states(server.id)
    except Exception:  # Redis down: still serve the server, just without voice info
        voice_states = []
    return ServerDetail(
        **ServerOut.model_validate(server).model_dump(),
        channels=[ChannelOut.model_validate(c) for c in channels],
        members=[MemberOut.model_validate(m).model_copy(update={"online": m.user_id in online}) for m in members],
        voice_states=voice_states,
    )


async def member_out(session: AsyncSession, member: ServerMember) -> MemberOut:
    online = await broker.online([member.user_id])
    return MemberOut.model_validate(member).model_copy(update={"online": member.user_id in online})


# --- Servers --------------------------------------------------------------------


@router.post("/servers", response_model=ServerDetail, status_code=status.HTTP_201_CREATED)
async def create_server(body: ServerCreate, user: CurrentUser, session: SessionDep) -> ServerDetail:
    server = Server(name=body.name, owner_id=user.id)
    session.add(server)
    await session.flush()
    session.add(ServerMember(server_id=server.id, user_id=user.id, role=MemberRole.owner))
    for position, (name, type_) in enumerate(DEFAULT_CHANNELS):
        session.add(Channel(server_id=server.id, name=name, type=type_, position=position))
    await session.commit()
    return await load_detail(session, server)


@router.get("/servers", response_model=list[ServerOut])
async def list_my_servers(user: CurrentUser, session: SessionDep) -> list[Server]:
    rows = await session.scalars(
        select(Server)
        .join(ServerMember, ServerMember.server_id == Server.id)
        .where(ServerMember.user_id == user.id)
        .order_by(ServerMember.joined_at)
    )
    return list(rows)


@router.get("/servers/{server_id}", response_model=ServerDetail)
async def get_server(server_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> ServerDetail:
    await get_membership(session, server_id, user.id)
    server = await session.get(Server, server_id)
    assert server is not None
    return await load_detail(session, server)


@router.patch("/servers/{server_id}", response_model=ServerOut)
async def update_server(server_id: uuid.UUID, body: ServerUpdate, user: CurrentUser, session: SessionDep) -> ServerOut:
    require_manager(await get_membership(session, server_id, user.id))
    server = await session.get(Server, server_id)
    assert server is not None
    if body.name is not None:
        server.name = body.name
    await session.commit()
    out = ServerOut.model_validate(server)
    await broker.publish("server.updated", out.model_dump(mode="json"), await server_member_ids(session, server_id))
    return out


@router.delete("/servers/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(server_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    member = await get_membership(session, server_id, user.id)
    if member.role != MemberRole.owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only the owner can delete the server")
    recipients = await server_member_ids(session, server_id)
    server = await session.get(Server, server_id)
    await session.delete(server)
    await session.commit()
    await voice.clear_server(server_id)
    await broker.publish("server.deleted", {"id": str(server_id)}, recipients)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/servers/{server_id}/members/me", status_code=status.HTTP_204_NO_CONTENT)
async def leave_server(server_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    member = await get_membership(session, server_id, user.id)
    if member.role == MemberRole.owner:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="The owner can't leave; delete the server instead")
    await session.delete(member)
    await session.commit()
    recipients = [*await server_member_ids(session, server_id), user.id]
    await voice.leave_server(user.id, server_id, recipients)
    await broker.publish("server.member.left", {"server_id": str(server_id), "user_id": str(user.id)}, recipients)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Channels -------------------------------------------------------------------


@router.post("/servers/{server_id}/channels", response_model=ChannelOut, status_code=status.HTTP_201_CREATED)
async def create_channel(server_id: uuid.UUID, body: ChannelCreate, user: CurrentUser, session: SessionDep) -> ChannelOut:
    require_manager(await get_membership(session, server_id, user.id))
    type_ = ChannelType(body.type)
    last = await session.scalar(select(func.max(Channel.position)).where(Channel.server_id == server_id))
    channel = Channel(
        server_id=server_id,
        name=normalize_channel_name(body.name, type_),
        type=type_,
        position=(last + 1) if last is not None else 0,
    )
    session.add(channel)
    await session.commit()
    out = ChannelOut.model_validate(channel)
    await broker.publish("channel.created", out.model_dump(mode="json"), await server_member_ids(session, server_id))
    return out


# --- Invites --------------------------------------------------------------------


@router.post("/servers/{server_id}/invites", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
async def create_invite(server_id: uuid.UUID, body: InviteCreate, user: CurrentUser, session: SessionDep) -> Invite:
    await get_membership(session, server_id, user.id)  # any member can invite friends
    invite = Invite(
        code=secrets.token_urlsafe(6),
        server_id=server_id,
        created_by=user.id,
        max_uses=body.max_uses,
        expires_at=datetime.now(UTC) + timedelta(hours=body.expires_in_hours) if body.expires_in_hours else None,
        uses=0,
    )
    session.add(invite)
    await session.commit()
    return invite


@router.post("/invites/{code}/join", response_model=ServerDetail)
async def join_with_invite(code: str, user: CurrentUser, session: SessionDep) -> ServerDetail:
    invite = await session.get(Invite, code)
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Invite not found")

    server = await session.get(Server, invite.server_id)
    assert server is not None
    if await session.get(ServerMember, (invite.server_id, user.id)) is not None:
        return await load_detail(session, server)  # already a member: idempotent, uses not counted

    # Atomic check-and-increment, so concurrent joins can't exceed max_uses.
    claimed = await session.scalar(
        update(Invite)
        .where(
            Invite.code == code,
            or_(Invite.max_uses.is_(None), Invite.uses < Invite.max_uses),
            or_(Invite.expires_at.is_(None), Invite.expires_at > func.now()),
        )
        .values(uses=Invite.uses + 1)
        .returning(Invite.code)
    )
    if claimed is None:
        raise HTTPException(status.HTTP_410_GONE, detail="Invite expired or used up")

    member = ServerMember(server_id=invite.server_id, user_id=user.id, role=MemberRole.member)
    session.add(member)
    await session.commit()
    await session.refresh(member)

    out = await member_out(session, member)
    await broker.publish(
        "server.member.joined",
        {"server_id": str(server.id), "member": out.model_dump(mode="json")},
        await server_member_ids(session, server.id),
    )
    return await load_detail(session, server)
