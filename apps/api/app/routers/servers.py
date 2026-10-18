import secrets
import uuid
from datetime import UTC, datetime, timedelta

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import images, presence, reads, voice
from app.access import get_membership, server_member_ids
from app.deps import CurrentUser, SessionDep
from app.models import Channel, ChannelType, Invite, Role, Server, ServerBan, ServerMember, User
from app.permissions import (
    DEFAULT_EVERYONE,
    Context,
    Overwrite,
    Perm,
    ServerAccess,
    channel_overwrites,
    channel_viewers,
    load_context,
    server_access,
)
from app.realtime import broker
from app.routers.users import ImageUpload
from app.schemas import (
    BanCreate,
    BanOut,
    ChannelCreate,
    ChannelOut,
    InviteCreate,
    InviteOut,
    MemberOut,
    MemberUpdate,
    MessageOut,
    OverrideOut,
    ReadStateOut,
    RoleOut,
    ServerCreate,
    ServerDetail,
    ServerOut,
    ServerUpdate,
    UserPublic,
)

router = APIRouter(tags=["servers"])

DEFAULT_CHANNELS = [("geral", ChannelType.text), ("Geral", ChannelType.voice)]


def normalize_channel_name(name: str, type_: ChannelType) -> str:
    # Text channels follow the familiar "lowercase-with-dashes" style.
    return "-".join(name.lower().split()) if type_ == ChannelType.text else name


def channel_out(channel: Channel, overwrites: list[Overwrite] | None = None) -> ChannelOut:
    out = ChannelOut.model_validate(channel)
    if overwrites:
        out.overrides = [OverrideOut(target_type=o.target, target_id=o.target_id, allow=o.allow, deny=o.deny) for o in overwrites]
    return out


def member_out(member: ServerMember, ctx: Context, status_: str = "offline") -> MemberOut:
    # Strongest role first, so clients can take the name color from the first colored one.
    role_ids = sorted(ctx.member_roles.get(member.user_id, ()), key=lambda r: -ctx.roles[r].position if r in ctx.roles else 0)
    return MemberOut(
        user=UserPublic.model_validate(member.user),
        role_ids=role_ids,
        joined_at=member.joined_at,
        nickname=member.nickname,
        voice_muted=member.voice_muted,
        voice_deafened=member.voice_deafened,
        status=status_,
    )


async def load_detail(session: AsyncSession, server: Server, user_id: uuid.UUID) -> ServerDetail:
    """The full server as seen by one user: only the channels they can see, and their read state."""
    channels = list(
        await session.scalars(select(Channel).where(Channel.server_id == server.id).order_by(Channel.position, Channel.name))
    )
    overwrites = await channel_overwrites(session, [c.id for c in channels])
    ctx = await load_context(session, server.id)
    access = ServerAccess(ctx, user_id, overwrites)
    visible = [c for c in channels if access.can_view(c)]
    visible_ids = {c.id for c in visible}
    roles = await session.scalars(select(Role).where(Role.server_id == server.id).order_by(Role.position.desc()))
    members = list(
        await session.scalars(
            select(ServerMember).where(ServerMember.server_id == server.id).order_by(ServerMember.joined_at)
        )
    )
    statuses = await presence.statuses(m.user_id for m in members)
    try:
        voice_states = await voice.get_states(voice.server_scope(server.id))
    except Exception:  # Redis down: still serve the server, just without voice info
        voice_states = []
    return ServerDetail(
        **ServerOut.model_validate(server).model_dump(),
        roles=[RoleOut.model_validate(r) for r in roles],
        channels=[channel_out(c, overwrites[c.id]) for c in visible],
        members=[member_out(m, ctx, statuses[m.user_id]) for m in members],
        voice_states=[v for v in voice_states if v.channel_id in visible_ids],
        reads=[
            ReadStateOut(channel_id=c, last_read_message_id=last, unread_count=unread, mention_count=mentions)
            for c, last, unread, mentions in await reads.server_states(session, user_id, server.id)
            if c in visible_ids
        ],
    )


async def permissions_changed(session: AsyncSession, server_id: uuid.UUID) -> None:
    """Roles, member roles or channel overrides changed. Members refetch the server (which
    channels they see may differ now), and anyone in a room they can't join anymore leaves it."""
    await broker.publish("server.permissions.updated", {"server_id": str(server_id)}, await server_member_ids(session, server_id))
    scope = voice.server_scope(server_id)
    try:
        states = await voice.get_states(scope)
    except Exception:
        return
    if not states:
        return
    ctx = await load_context(session, server_id)
    channels = {c.id: c for c in await session.scalars(select(Channel).where(Channel.server_id == server_id))}
    overwrites = await channel_overwrites(session, channels)
    for state in states:
        channel = channels.get(state.channel_id)
        if channel and not ctx.in_channel(state.user_id, overwrites[channel.id], voice=True) & Perm.CONNECT:
            await voice.leave_scope(state.user_id, scope, [*await channel_viewers(session, channel), state.user_id])


async def _publish_server(session: AsyncSession, server: Server) -> ServerOut:
    out = ServerOut.model_validate(server)
    await broker.publish("server.updated", out.model_dump(mode="json"), await server_member_ids(session, server.id))
    return out


# --- Servers --------------------------------------------------------------------


@router.post("/servers", response_model=ServerDetail, status_code=status.HTTP_201_CREATED)
async def create_server(body: ServerCreate, user: CurrentUser, session: SessionDep) -> ServerDetail:
    server = Server(name=body.name, owner_id=user.id)
    session.add(server)
    await session.flush()
    session.add(ServerMember(server_id=server.id, user_id=user.id))
    session.add(Role(id=server.id, server_id=server.id, name="@everyone", position=0, permissions=int(DEFAULT_EVERYONE)))
    for position, (name, type_) in enumerate(DEFAULT_CHANNELS):
        session.add(Channel(server_id=server.id, name=name, type=type_, position=position))
    await session.commit()
    return await load_detail(session, server, user.id)


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
    return await load_detail(session, server, user.id)


@router.patch("/servers/{server_id}", response_model=ServerOut)
async def update_server(server_id: uuid.UUID, body: ServerUpdate, user: CurrentUser, session: SessionDep) -> ServerOut:
    (await server_access(session, server_id, user.id)).require(Perm.MANAGE_SERVER)
    server = await session.get(Server, server_id)
    assert server is not None
    if body.name is not None:
        server.name = body.name
    await session.commit()
    return await _publish_server(session, server)


async def _set_image(server_id: uuid.UUID, field: str, upload: ImageUpload | None, user: User, session: AsyncSession) -> ServerOut:
    (await server_access(session, server_id, user.id)).require(Perm.MANAGE_SERVER)
    server = await session.get(Server, server_id)
    assert server is not None
    new_url = await images.store_upload(upload, f"servers/{server_id}") if upload else None
    old_url = getattr(server, field)
    setattr(server, field, new_url)
    await images.replace(old_url, new_url, session.commit)
    return await _publish_server(session, server)


@router.post("/servers/{server_id}/icon", response_model=ServerOut)
async def upload_icon(server_id: uuid.UUID, file: ImageUpload, user: CurrentUser, session: SessionDep) -> ServerOut:
    return await _set_image(server_id, "icon_url", file, user, session)


@router.delete("/servers/{server_id}/icon", response_model=ServerOut)
async def remove_icon(server_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> ServerOut:
    return await _set_image(server_id, "icon_url", None, user, session)


@router.post("/servers/{server_id}/banner", response_model=ServerOut)
async def upload_banner(server_id: uuid.UUID, file: ImageUpload, user: CurrentUser, session: SessionDep) -> ServerOut:
    return await _set_image(server_id, "banner_url", file, user, session)


@router.delete("/servers/{server_id}/banner", response_model=ServerOut)
async def remove_banner(server_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> ServerOut:
    return await _set_image(server_id, "banner_url", None, user, session)


@router.delete("/servers/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(server_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    await get_membership(session, server_id, user.id)
    server = await session.get(Server, server_id)
    assert server is not None
    if server.owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only the owner can delete the server")
    recipients = await server_member_ids(session, server_id)
    await session.delete(server)
    await session.commit()
    await voice.clear_server(server_id)
    await broker.publish("server.deleted", {"id": str(server_id)}, recipients)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _remove_member(session: AsyncSession, member: ServerMember) -> None:
    """Takes someone out of a server (leaving, kicked or banned): their roles go with the
    membership, and they leave its voice rooms. Commits."""
    server_id, user_id = member.server_id, member.user_id
    await session.delete(member)
    await reads.forget_server(session, user_id, server_id)
    await session.commit()
    recipients = [*await server_member_ids(session, server_id), user_id]
    await voice.leave_scope(user_id, voice.server_scope(server_id), recipients)
    await broker.publish("server.member.left", {"server_id": str(server_id), "user_id": str(user_id)}, recipients)


@router.delete("/servers/{server_id}/members/me", status_code=status.HTTP_204_NO_CONTENT)
async def leave_server(server_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    member = await get_membership(session, server_id, user.id)
    if await session.scalar(select(Server.owner_id).where(Server.id == server_id)) == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="The owner can't leave; delete the server instead")
    await _remove_member(session, member)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _require_can_moderate(access: ServerAccess, target_id: uuid.UUID, perm: Perm) -> None:
    access.require(perm)
    if target_id == access.user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="You can't do this to yourself")
    if target_id == access.ctx.owner_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="The owner can't be removed")
    access.require_outranks(access.ctx.rank(target_id), "this member")


@router.delete("/servers/{server_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def kick_member(server_id: uuid.UUID, user_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    access = await server_access(session, server_id, user.id)
    member = await session.get(ServerMember, (server_id, user_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Member not found")
    _require_can_moderate(access, user_id, Perm.KICK_MEMBERS)
    await _remove_member(session, member)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/servers/{server_id}/members/{user_id}", response_model=MemberOut)
async def update_member(
    server_id: uuid.UUID, user_id: uuid.UUID, body: MemberUpdate, user: CurrentUser, session: SessionDep
) -> MemberOut:
    """Sets a member's nickname: your own with CHANGE_NICKNAME, someone ranked below you with
    MANAGE_NICKNAMES."""
    access = await server_access(session, server_id, user.id)
    member = await session.get(ServerMember, (server_id, user_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Member not found")
    if user_id == user.id:
        access.require(Perm.CHANGE_NICKNAME)
    else:
        access.require(Perm.MANAGE_NICKNAMES)
        access.require_outranks(access.ctx.rank(user_id), "this member")
    member.nickname = body.nickname or None
    await session.commit()
    await session.refresh(member)
    out = member_out(member, access.ctx, (await presence.statuses([user_id]))[user_id])
    await broker.publish(
        "server.member.updated",
        {"server_id": str(server_id), "member": out.model_dump(mode="json")},
        await server_member_ids(session, server_id),
    )
    return out


@router.get("/servers/{server_id}/bans", response_model=list[BanOut])
async def list_bans(server_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> list[ServerBan]:
    (await server_access(session, server_id, user.id)).require(Perm.BAN_MEMBERS)
    rows = await session.scalars(select(ServerBan).where(ServerBan.server_id == server_id).order_by(ServerBan.created_at))
    return list(rows)


@router.put("/servers/{server_id}/bans/{user_id}", response_model=BanOut)
async def ban_member(
    server_id: uuid.UUID, user_id: uuid.UUID, user: CurrentUser, session: SessionDep, body: BanCreate | None = None
) -> ServerBan:
    """Bans someone (a member or not): they're removed and can't come back with an invite."""
    access = await server_access(session, server_id, user.id)
    if await session.get(User, user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    _require_can_moderate(access, user_id, Perm.BAN_MEMBERS)
    reason = (body.reason or None) if body else None
    await session.execute(
        insert(ServerBan)
        .values(server_id=server_id, user_id=user_id, banned_by=user.id, reason=reason)
        .on_conflict_do_update(index_elements=[ServerBan.server_id, ServerBan.user_id], set_={"reason": reason})
    )
    await session.commit()
    if (member := await session.get(ServerMember, (server_id, user_id))) is not None:
        await _remove_member(session, member)
    ban = await session.get(ServerBan, (server_id, user_id), populate_existing=True)
    assert ban is not None
    return ban


@router.delete("/servers/{server_id}/bans/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unban_member(server_id: uuid.UUID, user_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    (await server_access(session, server_id, user.id)).require(Perm.BAN_MEMBERS)
    ban = await session.get(ServerBan, (server_id, user_id))
    if ban is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Ban not found")
    await session.delete(ban)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/servers/{server_id}/unread", response_model=list[MessageOut])
async def unread_messages(
    server_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list:
    """Newest unread messages across the server's text channels the user can see (the overview's feed)."""
    channels = list(await session.scalars(select(Channel).where(Channel.server_id == server_id)))
    access = await server_access(session, server_id, user.id, [c.id for c in channels])
    readable = [c.id for c in channels if access.channel(c) & Perm.READ_HISTORY]
    return await reads.unread_feed(session, user.id, readable, limit)


@router.post("/servers/{server_id}/read", response_model=list[ReadStateOut])
async def mark_server_read(server_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> list[ReadStateOut]:
    """Marks every text channel of the server the user can see as read."""
    channels = list(
        await session.scalars(select(Channel).where(Channel.server_id == server_id, Channel.type == ChannelType.text))
    )
    access = await server_access(session, server_id, user.id, [c.id for c in channels])
    states = []
    for channel in channels:
        if access.can_view(channel):
            last_read, unread = await reads.mark_read(session, user.id, channel.id, None)
            states.append(ReadStateOut(channel_id=channel.id, last_read_message_id=last_read, unread_count=unread, mention_count=0))
    await session.commit()
    for state in states:
        # The user's other devices clear their badges too.
        await broker.publish("read.updated", {**state.model_dump(mode="json"), "server_id": str(server_id)}, [user.id])
    return states


# --- Channels -------------------------------------------------------------------


@router.post("/servers/{server_id}/channels", response_model=ChannelOut, status_code=status.HTTP_201_CREATED)
async def create_channel(server_id: uuid.UUID, body: ChannelCreate, user: CurrentUser, session: SessionDep) -> ChannelOut:
    (await server_access(session, server_id, user.id)).require(Perm.MANAGE_CHANNELS)
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
    out = channel_out(channel)
    await broker.publish("channel.created", out.model_dump(mode="json"), await channel_viewers(session, channel))
    return out


# --- Invites --------------------------------------------------------------------


@router.post("/servers/{server_id}/invites", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
async def create_invite(server_id: uuid.UUID, body: InviteCreate, user: CurrentUser, session: SessionDep) -> Invite:
    # Invites are also how new accounts get created, so @everyone doesn't have this by default.
    (await server_access(session, server_id, user.id)).require(Perm.CREATE_INVITE)
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
        return await load_detail(session, server, user.id)  # already a member: idempotent, uses not counted
    if await session.get(ServerBan, (invite.server_id, user.id)) is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You are banned from this server")

    if await claim_invite(session, code) is None:
        raise HTTPException(status.HTTP_410_GONE, detail="Invite expired or used up")

    member = ServerMember(server_id=invite.server_id, user_id=user.id)
    session.add(member)
    await session.commit()
    await announce_member_joined(session, member)
    return await load_detail(session, server, user.id)


async def claim_invite(session: AsyncSession, code: str) -> uuid.UUID | None:
    """Uses up one use of a valid invite and returns its server id (None if invalid,
    expired or used up). Atomic, so concurrent joins can't exceed max_uses. Not committed:
    callers commit it together with the membership they create."""
    return await session.scalar(
        update(Invite)
        .where(
            Invite.code == code,
            or_(Invite.max_uses.is_(None), Invite.uses < Invite.max_uses),
            or_(Invite.expires_at.is_(None), Invite.expires_at > func.now()),
        )
        .values(uses=Invite.uses + 1)
        .returning(Invite.server_id)
    )


async def announce_member_joined(session: AsyncSession, member: ServerMember) -> None:
    """Also marks the server's history read for the newcomer."""
    await reads.seed(session, member.user_id, member.server_id)
    await session.commit()
    await session.refresh(member)
    statuses = await presence.statuses([member.user_id])
    out = member_out(member, await load_context(session, member.server_id), statuses[member.user_id])
    await broker.publish(
        "server.member.joined",
        {"server_id": str(member.server_id), "member": out.model_dump(mode="json")},
        await server_member_ids(session, member.server_id),
    )
