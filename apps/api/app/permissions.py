"""Server permissions: roles, channel overrides and the role hierarchy.

The calculation (see docs/decisions/0007-roles-and-permissions.md):

1. The owner has every permission, everywhere.
2. Base = @everyone's permissions OR every role the member has.
3. ADMINISTRATOR in the base grants everything and skips channel overrides.
4. In a channel, overrides apply in order, each one "deny, then allow":
   @everyone's override, then all the member's roles' overrides together, then the member's own.
5. Without VIEW_CHANNEL a channel grants nothing; without CONNECT a voice channel grants no
   SPEAK, VIDEO or STREAM.

Hierarchy: a role ranks by its position (higher is stronger; @everyone is 0). A member ranks
as their highest role. Nobody manages a role or a member at or above their own rank, and
nobody grants a permission they don't have. The owner ignores all of this.

The pure functions here take plain data so they can be tested without a database; the
loaders at the bottom fetch what they need.
"""

import enum
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Channel, ChannelOverride, ChannelType, MemberRole, OverrideTarget, Role, Server, ServerMember


class Perm(enum.IntFlag):
    ADMINISTRATOR = 1 << 0
    MANAGE_SERVER = 1 << 1
    MANAGE_ROLES = 1 << 2
    MANAGE_CHANNELS = 1 << 3
    KICK_MEMBERS = 1 << 4
    BAN_MEMBERS = 1 << 5
    CREATE_INVITE = 1 << 6
    CHANGE_NICKNAME = 1 << 7
    MANAGE_NICKNAMES = 1 << 8
    VIEW_CHANNEL = 1 << 9
    SEND_MESSAGES = 1 << 10
    ATTACH_FILES = 1 << 11
    ADD_REACTIONS = 1 << 12
    MENTION_EVERYONE = 1 << 13
    MANAGE_MESSAGES = 1 << 14
    READ_HISTORY = 1 << 15
    CONNECT = 1 << 16
    SPEAK = 1 << 17
    VIDEO = 1 << 18
    STREAM = 1 << 19
    MUTE_MEMBERS = 1 << 20
    DEAFEN_MEMBERS = 1 << 21
    MOVE_MEMBERS = 1 << 22
    MANAGE_ADDONS = 1 << 23
    # Addon permissions (ADR 0027): bits of their own, so roles and channels can set them apart
    # from messages. Stored in BIGINT (63 usable bits), but the desktop app does 32-bit math, so
    # new bits stay at or below 1 << 30 until it moves to BigInt.
    EDIT_WHITEBOARD = 1 << 24


ALL = Perm((1 << len(Perm)) - 1)

# What @everyone can do in a new server. Invites also create accounts, so handing them out
# is left to roles the owner picks.
DEFAULT_EVERYONE = (
    Perm.CHANGE_NICKNAME
    | Perm.VIEW_CHANNEL
    | Perm.SEND_MESSAGES
    | Perm.ATTACH_FILES
    | Perm.ADD_REACTIONS
    | Perm.READ_HISTORY
    | Perm.CONNECT
    | Perm.SPEAK
    | Perm.VIDEO
    | Perm.STREAM
    | Perm.EDIT_WHITEBOARD
)

# Permissions that only make sense per channel; the rest are server-wide and are ignored in
# channel overrides.
CHANNEL_PERMS = (
    Perm.MANAGE_CHANNELS
    | Perm.MANAGE_ROLES
    | Perm.CREATE_INVITE
    | Perm.VIEW_CHANNEL
    | Perm.SEND_MESSAGES
    | Perm.ATTACH_FILES
    | Perm.ADD_REACTIONS
    | Perm.MENTION_EVERYONE
    | Perm.MANAGE_MESSAGES
    | Perm.READ_HISTORY
    | Perm.CONNECT
    | Perm.SPEAK
    | Perm.VIDEO
    | Perm.STREAM
    | Perm.MUTE_MEMBERS
    | Perm.DEAFEN_MEMBERS
    | Perm.MOVE_MEMBERS
    | Perm.MANAGE_ADDONS
    | Perm.EDIT_WHITEBOARD
)

VOICE_ONLY = Perm.SPEAK | Perm.VIDEO | Perm.STREAM | Perm.MUTE_MEMBERS | Perm.DEAFEN_MEMBERS | Perm.MOVE_MEMBERS

OWNER_RANK = 1 << 30  # above any role position


# --- Pure calculation -----------------------------------------------------------


@dataclass(frozen=True)
class RoleInfo:
    id: uuid.UUID
    position: int
    permissions: int


@dataclass(frozen=True)
class Overwrite:
    target: OverrideTarget
    target_id: uuid.UUID
    allow: int
    deny: int


@dataclass
class Context:
    """Everything needed to compute permissions in one server."""

    server_id: uuid.UUID
    owner_id: uuid.UUID
    roles: dict[uuid.UUID, RoleInfo]
    # user id -> their role ids (without @everyone)
    member_roles: dict[uuid.UUID, set[uuid.UUID]] = field(default_factory=dict)

    @property
    def everyone(self) -> RoleInfo:
        return self.roles[self.server_id]

    def roles_of(self, user_id: uuid.UUID) -> list[RoleInfo]:
        return [self.roles[r] for r in self.member_roles.get(user_id, ()) if r in self.roles]

    def rank(self, user_id: uuid.UUID) -> int:
        if user_id == self.owner_id:
            return OWNER_RANK
        return max((r.position for r in self.roles_of(user_id)), default=0)

    def base(self, user_id: uuid.UUID) -> Perm:
        if user_id == self.owner_id:
            return ALL
        perms = self.everyone.permissions
        for role in self.roles_of(user_id):
            perms |= role.permissions
        return ALL if perms & Perm.ADMINISTRATOR else Perm(perms & ALL)

    def in_channel(self, user_id: uuid.UUID, overwrites: Iterable[Overwrite], *, voice: bool) -> Perm:
        perms = self.base(user_id)
        if perms & Perm.ADMINISTRATOR:
            return ALL
        by_target = {(o.target, o.target_id): o for o in overwrites}
        own_roles = self.member_roles.get(user_id, set())

        def apply(p: int, o: Overwrite | None) -> int:
            return (p & ~o.deny) | o.allow if o else p

        perms_int = apply(int(perms), by_target.get((OverrideTarget.role, self.server_id)))
        role_deny = role_allow = 0
        for (target, target_id), o in by_target.items():
            if target == OverrideTarget.role and target_id in own_roles:
                role_deny |= o.deny
                role_allow |= o.allow
        perms_int = (perms_int & ~role_deny) | role_allow
        perms_int = apply(perms_int, by_target.get((OverrideTarget.member, user_id)))

        result = Perm(perms_int & ALL)
        if not result & Perm.VIEW_CHANNEL:
            return Perm(0)
        if voice and not result & Perm.CONNECT:
            result &= ~VOICE_ONLY
        return result


def outranks(ctx: Context, actor_id: uuid.UUID, rank: int) -> bool:
    """Whether the actor can manage something of this rank (a role position or a member's rank)."""
    return actor_id == ctx.owner_id or ctx.rank(actor_id) > rank


# --- Loading --------------------------------------------------------------------


def _forbidden(detail: str = "You don't have permission to do this") -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, detail=detail)


async def load_context(session: AsyncSession, server_id: uuid.UUID) -> Context:
    owner_id = await session.scalar(select(Server.owner_id).where(Server.id == server_id))
    if owner_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Server not found")
    roles = {
        r.id: RoleInfo(r.id, r.position, r.permissions)
        for r in await session.scalars(select(Role).where(Role.server_id == server_id))
    }
    ctx = Context(server_id, owner_id, roles)
    rows = await session.execute(
        select(MemberRole.user_id, MemberRole.role_id).where(MemberRole.server_id == server_id)
    )
    for user_id, role_id in rows:
        ctx.member_roles.setdefault(user_id, set()).add(role_id)
    return ctx


async def channel_overwrites(session: AsyncSession, channel_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, list[Overwrite]]:
    ids = list(channel_ids)
    result: dict[uuid.UUID, list[Overwrite]] = {c: [] for c in ids}
    if not ids:
        return result
    for o in await session.scalars(select(ChannelOverride).where(ChannelOverride.channel_id.in_(ids))):
        result[o.channel_id].append(Overwrite(o.target_type, o.target_id, o.allow, o.deny))
    return result


def is_voice(channel: Channel) -> bool:
    return channel.type == ChannelType.voice


class ServerAccess:
    """One user's permissions in one server, with the context to check others."""

    def __init__(self, ctx: Context, user_id: uuid.UUID, overwrites: dict[uuid.UUID, list[Overwrite]]) -> None:
        self.ctx = ctx
        self.user_id = user_id
        self.base = ctx.base(user_id)
        self._overwrites = overwrites

    @property
    def is_owner(self) -> bool:
        return self.user_id == self.ctx.owner_id

    @property
    def rank(self) -> int:
        return self.ctx.rank(self.user_id)

    def has(self, perm: Perm) -> bool:
        return bool(self.base & perm)

    def require(self, perm: Perm) -> None:
        if not self.has(perm):
            raise _forbidden()

    def channel(self, channel: Channel) -> Perm:
        return self.ctx.in_channel(self.user_id, self._overwrites.get(channel.id, []), voice=is_voice(channel))

    def of_member(self, user_id: uuid.UUID, channel: Channel) -> Perm:
        """Someone else's permissions in a channel whose overrides were loaded."""
        return self.ctx.in_channel(user_id, self._overwrites.get(channel.id, []), voice=is_voice(channel))

    def can_view(self, channel: Channel) -> bool:
        return bool(self.channel(channel) & Perm.VIEW_CHANNEL)

    def require_in(self, channel: Channel, perm: Perm) -> None:
        if not self.channel(channel) & perm:
            raise _forbidden()

    def require_outranks(self, rank: int, what: str = "this") -> None:
        if not outranks(self.ctx, self.user_id, rank):
            raise _forbidden(f"You can't manage {what}: it's at or above your highest role")

    def require_grantable(self, perms: int, within: Perm | None = None) -> None:
        """Nobody grants (or denies) a permission they don't have themselves."""
        mine = self.base if within is None else within
        if perms & ~int(mine) and not self.base & Perm.ADMINISTRATOR:
            raise _forbidden("You can't grant permissions you don't have")


async def server_access(
    session: AsyncSession, server_id: uuid.UUID, user_id: uuid.UUID, channels: Iterable[uuid.UUID] = ()
) -> ServerAccess:
    """404 for non-members (server ids can't be probed). Loads overrides for `channels`."""
    if await session.get(ServerMember, (server_id, user_id)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Server not found")
    ctx = await load_context(session, server_id)
    return ServerAccess(ctx, user_id, await channel_overwrites(session, channels))


async def channel_viewers(session: AsyncSession, channel: Channel) -> list[uuid.UUID]:
    """Members of the channel's server who can see it."""
    assert channel.server_id is not None
    ctx = await load_context(session, channel.server_id)
    overwrites = (await channel_overwrites(session, [channel.id]))[channel.id]
    members = await session.scalars(select(ServerMember.user_id).where(ServerMember.server_id == channel.server_id))
    voice = is_voice(channel)
    return [u for u in members if ctx.in_channel(u, overwrites, voice=voice) & Perm.VIEW_CHANNEL]


async def visible_channel_ids(session: AsyncSession, server_id: uuid.UUID, user_id: uuid.UUID) -> set[uuid.UUID]:
    """The server's channels the user can see (empty if not a member)."""
    if await session.get(ServerMember, (server_id, user_id)) is None:
        return set()
    channels = list(await session.scalars(select(Channel).where(Channel.server_id == server_id)))
    access = ServerAccess(
        await load_context(session, server_id), user_id, await channel_overwrites(session, [c.id for c in channels])
    )
    return {c.id for c in channels if access.can_view(c)}
