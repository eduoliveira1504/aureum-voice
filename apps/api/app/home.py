"""The Home hub (Início): the parts the app doesn't already hold in memory.

The app keeps every server (visible channels, voice states, members), DM, friend request and
missed call live from their own routes and events, and builds "Ao vivo agora", "Amigos
ativos" and "Seus servidores" from them. What needs the database is here: unread mentions and
unread DMs with a preview, the user's tasks from addons, and each server's latest activity.
Every server channel goes through the user's permissions first (see
docs/decisions/0022-home-hub.md).
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime

from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import reads
from app.addons.base import AssignedItem
from app.addons.registry import get_addon
from app.models import Channel, ChannelMember, ChannelRead, ChannelType, Message, Server, ServerMember, User, UserSettings
from app.permissions import Perm, ServerAccess, channel_overwrites, load_context
from app.schemas import MessageOut

MENTIONS_LIMIT = 50
# Home shows a few tasks; "Ver todas" asks for the whole list (up to TASKS_LIMIT).
TASKS_PREVIEW = 6
TASKS_LIMIT = 200
# Messages that merely contain "@name" are scanned for a real mention; this bounds the scan.
MENTION_SCAN = MENTIONS_LIMIT * 4


class HomeMention(BaseModel):
    server_id: uuid.UUID
    message: MessageOut


class HomeDm(BaseModel):
    """An unread DM or group: how many unread messages and the newest one from someone else."""

    channel_id: uuid.UUID
    unread_count: int
    message: MessageOut


class HomeTask(AssignedItem):
    addon_key: str
    server_id: uuid.UUID
    server_name: str
    channel_id: uuid.UUID
    channel_name: str


class HomeServer(BaseModel):
    id: uuid.UUID
    # Newest message in a channel the user can see; None if there's none.
    last_activity_at: datetime | None


class HomeOut(BaseModel):
    mentions: list[HomeMention]
    dms: list[HomeDm]
    tasks: list[HomeTask]
    tasks_total: int
    servers: list[HomeServer]


@dataclass
class _Server:
    server: Server
    channels: list[Channel]
    access: ServerAccess

    def channels_with(self, perm: Perm, type_: ChannelType) -> list[Channel]:
        return [c for c in self.channels if c.type == type_ and self.access.channel(c) & perm]


async def _servers(session: AsyncSession, user_id: uuid.UUID) -> list[_Server]:
    """The user's servers with their channels and the user's permissions in each."""
    servers = list(
        await session.scalars(
            select(Server).join(ServerMember, ServerMember.server_id == Server.id).where(ServerMember.user_id == user_id)
        )
    )
    if not servers:
        return []
    channels = list(await session.scalars(select(Channel).where(Channel.server_id.in_([s.id for s in servers]))))
    overwrites = await channel_overwrites(session, [c.id for c in channels])
    return [
        _Server(
            server,
            [c for c in channels if c.server_id == server.id],
            ServerAccess(await load_context(session, server.id), user_id, overwrites),
        )
        for server in servers
    ]


def _readable(servers: list[_Server]) -> dict[uuid.UUID, uuid.UUID]:
    """Text channels whose history the user can read: channel id -> server id."""
    return {c.id: s.server.id for s in servers for c in s.channels_with(Perm.READ_HISTORY, ChannelType.text)}


def _not_mine(user_id: uuid.UUID):  # noqa: ANN202
    return or_(Message.author_id.is_(None), Message.author_id != user_id)


async def _mention_channels(session: AsyncSession, user_id: uuid.UUID, readable: dict[uuid.UUID, uuid.UUID]) -> dict[uuid.UUID, int]:
    """Readable channels with mentions of the user since the last read: id -> last read id."""
    if not readable:
        return {}
    rows = await session.execute(
        select(ChannelRead.channel_id, ChannelRead.last_read_message_id).where(
            ChannelRead.user_id == user_id, ChannelRead.mention_count > 0, ChannelRead.channel_id.in_(readable)
        )
    )
    return {channel_id: last_read or 0 for channel_id, last_read in rows}


async def mentions(session: AsyncSession, user: User, readable: dict[uuid.UUID, uuid.UUID]) -> list[HomeMention]:
    """Unread messages that mention the user, newest first. Mentions are matched exactly like
    reads.record_mentions counts them (same parser, case-insensitive, whole name), so the list
    agrees with the channels' mention counters."""
    marked = await _mention_channels(session, user.id, readable)
    if not marked:
        return []
    after_read = or_(*(and_(Message.channel_id == cid, Message.id > last) for cid, last in marked.items()))
    # A cheap filter first; LIKE may over-match ("_" is a wildcard), the parser below decides.
    candidates = await session.scalars(
        select(Message)
        .where(after_read, _not_mine(user.id), Message.content.ilike(f"%@{user.username}%"))
        .order_by(Message.id.desc())
        .limit(MENTION_SCAN)
    )
    name = user.username.lower()
    found = [m for m in candidates if name in reads.mentioned_usernames(m.content)][:MENTIONS_LIMIT]
    return [HomeMention(server_id=readable[m.channel_id], message=MessageOut.model_validate(m)) for m in found]


async def _muted(session: AsyncSession, user_id: uuid.UUID) -> set[str]:
    settings = await session.get(UserSettings, user_id)
    return set(settings.muted_places) if settings else set()


async def _unread_dms(session: AsyncSession, user_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """Open DMs and groups with unread messages, not silenced: id -> unread count."""
    ids = list(
        await session.scalars(
            select(ChannelMember.channel_id).where(ChannelMember.user_id == user_id, ChannelMember.hidden.is_(False))
        )
    )
    muted = await _muted(session, user_id)
    states = await reads.channel_states(session, user_id, ids)
    return {cid: unread for cid, (_, _, unread, _) in states.items() if unread > 0 and str(cid) not in muted}


async def dms(session: AsyncSession, user_id: uuid.UUID) -> list[HomeDm]:
    unread = await _unread_dms(session, user_id)
    if not unread:
        return []
    newest = (
        select(func.max(Message.id))
        .where(Message.channel_id.in_(unread), _not_mine(user_id))
        .group_by(Message.channel_id)
    )
    messages = await session.scalars(select(Message).where(Message.id.in_(newest)).order_by(Message.id.desc()))
    return [
        HomeDm(channel_id=m.channel_id, unread_count=unread[m.channel_id], message=MessageOut.model_validate(m))
        for m in messages
    ]


def _task_order(task: HomeTask) -> tuple[bool, date, float]:
    # Overdue and soonest due first (earliest dates come first), then undated, newest first.
    return (task.due_date is None, task.due_date or date.max, -task.updated_at.timestamp())


async def tasks(session: AsyncSession, user_id: uuid.UUID, servers: list[_Server]) -> list[HomeTask]:
    """Unfinished addon items assigned to the user, in every addon channel they can see. Each
    addon gets only the workspaces (channels) the user may view; it never checks access itself."""
    places: dict[uuid.UUID, tuple[Server, Channel]] = {}
    by_addon: dict[str, list[uuid.UUID]] = {}
    for s in servers:
        for channel in s.channels_with(Perm.VIEW_CHANNEL, ChannelType.addon):
            addon = get_addon(channel.addon_key)
            if addon is None or addon.assigned is None:
                continue
            places[channel.id] = (s.server, channel)
            by_addon.setdefault(addon.key, []).append(channel.id)
    out = []
    for key, workspace_ids in by_addon.items():
        addon = get_addon(key)
        assert addon is not None and addon.assigned is not None
        for item in await addon.assigned(session, workspace_ids, user_id):
            server, channel = places[item.workspace_id]
            out.append(
                HomeTask(
                    **item.model_dump(),
                    addon_key=key,
                    server_id=server.id,
                    server_name=server.name,
                    channel_id=channel.id,
                    channel_name=channel.name or "",
                )
            )
    return sorted(out, key=_task_order)[:TASKS_LIMIT]


async def server_activity(session: AsyncSession, servers: list[_Server]) -> list[HomeServer]:
    visible = {c.id for s in servers for c in s.channels_with(Perm.VIEW_CHANNEL, ChannelType.text)}
    latest: dict[uuid.UUID, datetime] = {}
    if visible:
        rows = await session.execute(
            select(Channel.server_id, func.max(Message.created_at))
            .join(Message, Message.channel_id == Channel.id)
            .where(Channel.id.in_(visible))
            .group_by(Channel.server_id)
        )
        latest = {server_id: at for server_id, at in rows if server_id is not None}
    return [HomeServer(id=s.server.id, last_activity_at=latest.get(s.server.id)) for s in servers]


async def load(session: AsyncSession, user: User) -> HomeOut:
    servers = await _servers(session, user.id)
    all_tasks = await tasks(session, user.id, servers)
    return HomeOut(
        mentions=await mentions(session, user, _readable(servers)),
        dms=await dms(session, user.id),
        tasks=all_tasks[:TASKS_PREVIEW],
        tasks_total=len(all_tasks),
        servers=await server_activity(session, servers),
    )


async def my_tasks(session: AsyncSession, user_id: uuid.UUID) -> list[HomeTask]:
    return await tasks(session, user_id, await _servers(session, user_id))


async def pending_channels(session: AsyncSession, user_id: uuid.UUID) -> dict[uuid.UUID, uuid.UUID | None]:
    """The channels behind "Pra você ver" (mentions and unread DMs): id -> server id (None
    for DMs). "Marcar tudo como lido" marks exactly these."""
    readable = _readable(await _servers(session, user_id))
    channels: dict[uuid.UUID, uuid.UUID | None] = {
        cid: readable[cid] for cid in await _mention_channels(session, user_id, readable)
    }
    channels.update({cid: None for cid in await _unread_dms(session, user_id)})
    return channels
