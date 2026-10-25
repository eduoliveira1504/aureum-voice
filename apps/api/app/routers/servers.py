import secrets
import uuid
from datetime import UTC, datetime, timedelta

from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import attachments, bot, images, presence, reads, voice
from app.access import get_membership, server_member_ids
from app.addons import registry as addons
from app.deps import CurrentUser, SessionDep
from app.models import (
    Channel,
    ChannelOverride,
    ChannelType,
    Invite,
    OverrideTarget,
    Role,
    Server,
    ServerBan,
    ServerMember,
    User,
)
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
from app.routers.users import CropForm, ImageUpload
from app.schemas import (
    BanCreate,
    BanOut,
    ChannelCreate,
    ChannelOrder,
    ChannelOut,
    ChannelPosition,
    ImageCrop,
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

# Accounts sign in before confirming their e-mail, but only confirmed ones create servers.
EMAIL_NOT_CONFIRMED = "Confirm your e-mail to create servers"


@router.post("/servers", response_model=ServerDetail, status_code=status.HTTP_201_CREATED)
async def create_server(body: ServerCreate, user: CurrentUser, session: SessionDep) -> ServerDetail:
    if user.email_verified_at is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=EMAIL_NOT_CONFIRMED)
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


async def _managed_server(session: AsyncSession, server_id: uuid.UUID, user: User) -> Server:
    (await server_access(session, server_id, user.id)).require(Perm.MANAGE_SERVER)
    server = await session.get(Server, server_id)
    assert server is not None
    return server


def _image_routes(kind: Literal["icon", "banner"]) -> None:
    """Upload (optionally cropped), remove, re-crop and the kept original of the icon/banner."""

    @router.post(f"/servers/{{server_id}}/{kind}", response_model=ServerOut, name=f"upload_server_{kind}")
    async def upload(server_id: uuid.UUID, file: ImageUpload, user: CurrentUser, session: SessionDep, crop: CropForm = None) -> ServerOut:
        server = await _managed_server(session, server_id, user)
        await images.set_image(server, kind, file, images.crop_field(crop), f"servers/{server_id}", session.commit)
        return await _publish_server(session, server)

    @router.delete(f"/servers/{{server_id}}/{kind}", response_model=ServerOut, name=f"remove_server_{kind}")
    async def remove(server_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> ServerOut:
        server = await _managed_server(session, server_id, user)
        await images.set_image(server, kind, None, None, f"servers/{server_id}", session.commit)
        return await _publish_server(session, server)

    @router.put(f"/servers/{{server_id}}/{kind}/crop", response_model=ServerOut, name=f"recrop_server_{kind}")
    async def recrop(server_id: uuid.UUID, body: ImageCrop, user: CurrentUser, session: SessionDep) -> ServerOut:
        server = await _managed_server(session, server_id, user)
        await images.set_crop(server, kind, body, f"servers/{server_id}", session.commit)
        return await _publish_server(session, server)

    @router.get(f"/servers/{{server_id}}/{kind}/original", name=f"server_{kind}_original")
    async def original(server_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
        return await images.original(await _managed_server(session, server_id, user), kind)


_image_routes("icon")
_image_routes("banner")


@router.delete("/servers/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(server_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    await get_membership(session, server_id, user.id)
    server = await session.get(Server, server_id)
    assert server is not None
    if server.owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only the owner can delete the server")
    recipients = await server_member_ids(session, server_id)
    addon_channels = await session.execute(
        select(Channel.addon_key, Channel.id).where(Channel.server_id == server_id, Channel.type == ChannelType.addon)
    )
    files = await addons.cleanup(session, addon_channels.tuples())
    files += await attachments.keys_of_channels(
        session, await session.scalars(select(Channel.id).where(Channel.server_id == server_id))
    )
    await session.delete(server)
    await session.commit()
    await attachments.delete_keys(session, files)
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


@router.put("/servers/{server_id}/channels/order", response_model=list[ChannelPosition])
async def reorder_channels(server_id: uuid.UUID, body: ChannelOrder, user: CurrentUser, session: SessionDep) -> list[ChannelPosition]:
    """Reorders one sidebar section (rooms, conversations or addons). The order is the server's,
    the same for everyone. The list holds the section's channels the user can see; channels hidden
    from them keep their place for those who see them. Positions are renumbered across the whole
    server in one transaction. Returns the new positions of the channels the user can see."""
    access = await server_access(session, server_id, user.id)
    access.require(Perm.MANAGE_CHANNELS)
    # One reorder per server at a time, so two people dragging can't interleave.
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"channel_order:{server_id}"})
    channels = list(
        await session.scalars(select(Channel).where(Channel.server_id == server_id).order_by(Channel.position, Channel.name, Channel.id))
    )
    overwrites = await channel_overwrites(session, [c.id for c in channels])
    access = ServerAccess(access.ctx, user.id, overwrites)
    section_type = ChannelType(body.type)
    visible = [c for c in channels if c.type == section_type and access.can_view(c)]
    if len(body.channel_ids) != len(visible) or set(body.channel_ids) != {c.id for c in visible}:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail="List every channel of this section you can see, once"
        )
    # The visible channels take each other's slots in the new order; everything else stays put.
    by_id = {c.id: c for c in visible}
    moved = iter(by_id[i] for i in body.channel_ids)
    ordered = [next(moved) if c.id in by_id else c for c in channels]
    changed = [c for i, c in enumerate(ordered) if c.position != i]
    for i, channel in enumerate(ordered):
        channel.position = i
    await session.commit()
    if changed:
        await _announce_positions(session, server_id, changed, access.ctx, overwrites)
    return [ChannelPosition(id=c.id, position=c.position) for c in ordered if access.can_view(c)]


async def _announce_positions(
    session: AsyncSession, server_id: uuid.UUID, changed: list[Channel], ctx: Context, overwrites: dict[uuid.UUID, list[Overwrite]]
) -> None:
    """channels.reordered to every member, with only the channels they can see (one event per
    distinct view, not per person)."""
    audiences: dict[tuple[uuid.UUID, ...], list[uuid.UUID]] = {}
    for member_id in await server_member_ids(session, server_id):
        seen = tuple(
            c.id for c in changed if ctx.in_channel(member_id, overwrites.get(c.id, []), voice=c.type == ChannelType.voice) & Perm.VIEW_CHANNEL
        )
        if seen:
            audiences.setdefault(seen, []).append(member_id)
    positions = {c.id: c.position for c in changed}
    for seen, members in audiences.items():
        data = {"server_id": str(server_id), "channels": [{"id": str(i), "position": positions[i]} for i in seen]}
        await broker.publish("channels.reordered", data, members)



@router.post("/servers/{server_id}/channels", response_model=ChannelOut, status_code=status.HTTP_201_CREATED)
async def create_channel(server_id: uuid.UUID, body: ChannelCreate, user: CurrentUser, session: SessionDep) -> ChannelOut:
    access = await server_access(session, server_id, user.id)
    access.require(Perm.MANAGE_CHANNELS)
    type_ = ChannelType(body.type)
    config: dict = {}
    if type_ == ChannelType.addon:
        access.require(Perm.MANAGE_ADDONS)
        addon = addons.get_addon(body.addon_key)
        if addon is None or not addon.in_channel:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown addon")
        config = addon.parse_config(body.config)
    last = await session.scalar(select(func.max(Channel.position)).where(Channel.server_id == server_id))
    channel = Channel(
        server_id=server_id,
        name=normalize_channel_name(body.name, type_),
        type=type_,
        position=(last + 1) if last is not None else 0,
        addon_key=body.addon_key,
        config=config,
    )
    session.add(channel)
    await session.flush()
    overwrites = await _private_overrides(session, access, channel, body) if body.private else []
    await session.commit()
    out = channel_out(channel, overwrites)
    await broker.publish("channel.created", out.model_dump(mode="json"), await channel_viewers(session, channel))
    return out


async def _private_overrides(
    session: AsyncSession, access: ServerAccess, channel: Channel, body: ChannelCreate
) -> list[Overwrite]:
    """Makes a new channel private: @everyone is denied seeing it (and joining, for a room) and
    the picked roles and members are allowed. Same rules as editing overrides (MANAGE_ROLES,
    targets ranked below the creator, only bits the creator has); the creator keeps access."""
    access.require(Perm.MANAGE_ROLES)
    bits = Perm.VIEW_CHANNEL | (Perm.CONNECT if channel.type == ChannelType.voice else Perm(0))
    access.require_grantable(int(bits))
    server_id = channel.server_id
    assert server_id is not None
    overwrites = [Overwrite(OverrideTarget.role, server_id, 0, int(bits))]
    for role_id in dict.fromkeys(body.allowed_roles):
        role = access.ctx.roles.get(role_id)
        if role is None or role_id == server_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Role not found")
        access.require_outranks(role.position, "this role")
        overwrites.append(Overwrite(OverrideTarget.role, role_id, int(bits), 0))
    member_ids = list(dict.fromkeys(body.allowed_members))
    found = set(
        await session.scalars(
            select(ServerMember.user_id).where(ServerMember.server_id == server_id, ServerMember.user_id.in_(member_ids))
        )
    )
    for user_id in member_ids:
        if user_id not in found:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Member not found")
        if user_id != access.user_id:
            access.require_outranks(access.ctx.rank(user_id), "this member")
        overwrites.append(Overwrite(OverrideTarget.member, user_id, int(bits), 0))
    voice_room = channel.type == ChannelType.voice
    if not access.ctx.in_channel(access.user_id, overwrites, voice=voice_room) & Perm.VIEW_CHANNEL:
        overwrites.append(Overwrite(OverrideTarget.member, access.user_id, int(bits), 0))
    session.add_all(
        ChannelOverride(channel_id=channel.id, target_type=o.target, target_id=o.target_id, allow=o.allow, deny=o.deny)
        for o in overwrites
    )
    return overwrites


# --- Invites --------------------------------------------------------------------


@router.post("/servers/{server_id}/invites", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
async def create_invite(server_id: uuid.UUID, body: InviteCreate, user: CurrentUser, session: SessionDep) -> Invite:
    # Kept off @everyone by default, so owners choose who brings people in.
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
    if user.is_official and user.is_bot:
        # @aureum only acts in the official servers, which it is part of from the start.
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="A conta oficial do Aureum não entra em servidores por convite.")

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
    """Also marks the server's history read for the newcomer, and in an official server the bot
    welcomes them (once)."""
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
    await bot.welcome(member.server_id, member.user_id)
