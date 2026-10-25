"""What every addon is made of, and the one way addon code reaches a channel.

An addon is a self-contained package in app/addons/<key>/ (see
docs/decisions/0013-addon-framework.md). It never checks permissions or loads channels by
itself: its routes call `addon_channel`, which hands back the channel's id as a generic
`workspace_id`, so the addon's own tables don't need to know what a server or a channel is.
Addons that live in chats instead (polls, ADR 0028) call `addon_chat` the same way.
"""

import logging
import uuid
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.access import channel_audience, get_channel_for_member
from app.messages import chat_channel, post_message, require_dm_friends
from app.models import Channel, ChannelType, Message
from app.permissions import Perm, ServerAccess, channel_overwrites, channel_viewers
from app.realtime import broker
from app.schemas import MessageOut

log = logging.getLogger(__name__)

# System lines by the same person, from the same addon channel and group, posted this close
# together go into one message instead of one message each.
ANNOUNCE_MERGE_WINDOW = timedelta(minutes=2)
ANNOUNCE_MAX_LINES = 20

# Removes an addon's data for workspaces that are going away (their channel or server was deleted),
# in the caller's transaction. It may return object storage keys, deleted once that commits.
CleanupHook = Callable[[AsyncSession, list[uuid.UUID]], Awaitable[list[str] | None]]


class ItemLabel(BaseModel):
    name: str
    # A label token name (--label-<color>), never a raw color.
    color: str


class AssignedItem(BaseModel):
    """Something in an addon assigned to a user and not finished yet (a Kanban card), as the
    Home hub lists it. Addon-agnostic: the host adds where it lives (server, channel)."""

    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str
    # Where it stands now, in the addon's words (a Kanban column's name).
    status: str
    labels: list[ItemLabel] = []
    due_date: date | None = None
    updated_at: datetime


# The unfinished items assigned to a user in these workspaces. The host passes only
# workspaces the user can see; the addon never checks permissions itself.
AssignedHook = Callable[[AsyncSession, list[uuid.UUID], uuid.UUID], Awaitable[list[AssignedItem]]]


class DatedItem(BaseModel):
    """Something in an addon that happens or is due on a date (an event, a card's due date), as
    calendars and the Home hub list it. Addon-agnostic: the host adds where it lives."""

    # Unique within the addon; an event's weekly occurrences each get their own.
    id: str
    workspace_id: uuid.UUID
    # What the addon opens when the item is picked (AddonViewProps.openItem on the desktop).
    item_id: uuid.UUID
    title: str
    # The addon's own word for it ("event", "card"), for filters and icons.
    kind: str
    # All-day items (a due date) have only `day`; timed ones `starts_at` and maybe `ends_at`.
    all_day: bool
    day: date | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    # A label token name (--label-<color>), never a raw color; None leaves it to the client.
    color: str | None = None
    # Finished (a card in a done column) or called off (a cancelled event): shown apart.
    done: bool = False
    cancelled: bool = False
    # The user's own: assigned to them, or an event they said they're going to (or maybe).
    mine: bool = False


# What has a date between `start` and `end` (all-day items: whose date falls on a day the range
# touches) in these workspaces, with `mine` for this user. The host passes only workspaces the
# user can see; the addon never checks permissions itself.
DatedHook = Callable[[AsyncSession, list[uuid.UUID], datetime, datetime, uuid.UUID], Awaitable[list[DatedItem]]]


class SocketError(Exception):
    """Raised by a socket handler to answer the client with an error message."""


@dataclass
class AddonSocket:
    """A client's WebSocket connection, as an addon's socket handlers see it. For live things
    that aren't worth a request or a database row, like cursors."""

    manifest: "AddonManifest"
    websocket: WebSocket
    user_id: uuid.UUID
    # What the addon keeps about this connection between messages; dropped when it closes.
    state: dict[str, Any]

    async def channel(self, session: AsyncSession, channel_id: uuid.UUID, action: str = "view") -> "AddonChannel":
        """Like `addon_channel`, but a refusal becomes a SocketError."""
        try:
            return await addon_channel(session, self.manifest, channel_id, self.user_id, action)
        except HTTPException as e:
            raise SocketError(str(e.detail)) from None

    def join(self, rooms: Iterable[uuid.UUID]) -> None:
        """Sets the rooms (ids the addon picks) this connection is in; empty leaves them all. A
        connection gets the room's events from AddonChannel.publish_room and `relay`."""
        broker.watch(self.websocket, f"addon:{self.manifest.key}", rooms)

    async def relay(self, room: uuid.UUID, event: str, data: dict[str, Any], user_ids: Iterable[uuid.UUID]) -> None:
        """Sends `addon.<key>.<event>` to the other connections in the room, among `user_ids` (who
        can see it, which the addon keeps track of)."""
        await broker.publish_to_watchers(f"addon.{self.manifest.key}.{event}", data, room, user_ids, skip=self.websocket)


# Handles `addon.<key>.<name>` messages from clients; `data` is whatever the client sent.
SocketHandler = Callable[[AddonSocket, Any], Awaitable[None]]
SocketCloseHook = Callable[[AddonSocket], Awaitable[None]]


@dataclass(frozen=True)
class AddonManifest:
    key: str
    name: str
    description: str
    # A Lucide icon name, a hint for clients that don't ship the addon's own UI.
    icon: str
    # Mounted at /api/addons/<key>.
    router: APIRouter | None = None
    # The shape of channels.config for this addon; None means it takes no settings.
    config_model: type[BaseModel] | None = None
    # Named actions and the channel permission each needs. "view" is always VIEW_CHANNEL.
    permissions: Mapping[str, Perm] = field(default_factory=dict)
    on_cleanup: CleanupHook | None = None
    # Lists what's assigned to a user, for "Minhas tarefas" in Home; None if the addon has no
    # such thing.
    assigned: AssignedHook | None = None
    # Lists what has a date, for calendars and the Home hub; None if the addon has no such thing.
    dated_items: DatedHook | None = None
    # Whether it posts system lines (AddonChannel.announce) to a text channel picked in the
    # channel's settings.
    announces: bool = False
    # Handlers for `addon.<key>.<name>` messages on the WebSocket, by name.
    socket: Mapping[str, SocketHandler] = field(default_factory=dict)
    # Called when a connection that sent this addon messages closes.
    on_socket_close: SocketCloseHook | None = None
    # Runs for the life of the API process (deadlines, reminders); it must never return.
    worker: Callable[[], Awaitable[None]] | None = None
    # False for an addon that lives in chats (its things are messages, see AddonChat) and can't
    # be added as a channel.
    in_channel: bool = True

    def action_perm(self, action: str) -> Perm:
        if action == "view":
            return Perm.VIEW_CHANNEL
        return self.permissions[action]

    def parse_config(self, data: dict[str, Any] | None) -> dict[str, Any]:
        """Validates settings against the addon's model and fills in its defaults."""
        if self.config_model is None:
            if data:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This addon takes no settings")
            return {}
        try:
            return self.config_model.model_validate(data or {}).model_dump(mode="json")
        except ValueError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid addon settings: {e}") from None


@dataclass
class AddonChannel:
    """An addon channel as its addon sees it."""

    manifest: AddonManifest
    channel: Channel
    access: ServerAccess
    session: AsyncSession

    @property
    def workspace_id(self) -> uuid.UUID:
        return self.channel.id

    @property
    def config(self) -> dict[str, Any]:
        # Re-validated so settings saved before a new field existed get its default.
        return self.manifest.parse_config(self.channel.config)

    def can(self, action: str) -> bool:
        # An action mapped to several bits is allowed by any of them.
        return bool(self.access.channel(self.channel) & self.manifest.action_perm(action))

    def require(self, action: str) -> None:
        if not self.can(action):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You don't have permission to do this")

    async def voice_room(self, channel_id: uuid.UUID) -> Channel | None:
        """A voice room of the same server that the user can see (where an event happens), or
        None."""
        room = await self.session.get(Channel, channel_id)
        if room is None or room.type != ChannelType.voice or room.server_id != self.channel.server_id:
            return None
        overwrites = (await channel_overwrites(self.session, [room.id]))[room.id]
        perms = self.access.ctx.in_channel(self.access.user_id, overwrites, voice=True)
        return room if perms & Perm.VIEW_CHANNEL else None

    async def member_ids(self) -> set[uuid.UUID]:
        """Who can see the channel: the people the addon may assign things to."""
        return set(await channel_viewers(self.session, self.channel))

    async def publish(self, event: str, data: dict[str, Any]) -> None:
        """Sends `addon.<key>.<event>` to everyone who can see the channel."""
        payload = {"channel_id": str(self.channel.id), "server_id": str(self.channel.server_id), **data}
        await broker.publish(f"addon.{self.manifest.key}.{event}", payload, await channel_viewers(self.session, self.channel))

    async def publish_room(self, room: uuid.UUID, event: str, data: dict[str, Any]) -> None:
        """Sends `addon.<key>.<event>` only to the connections that joined `room` (an id the addon
        picks, like a whiteboard's) through the socket, among those who can still see the
        channel. For heavy events that only matter to whoever has that thing open."""
        payload = {"channel_id": str(self.channel.id), "server_id": str(self.channel.server_id), **data}
        await broker.publish_to_watchers(
            f"addon.{self.manifest.key}.{event}", payload, room, await channel_viewers(self.session, self.channel)
        )

    async def announce(self, text: str, *, group: str) -> None:
        """Posts a system line by the current user ("moveu “X” para Feito") to the text channel
        picked in the channel's settings, if any. Lines of the same `group` merge (see
        ANNOUNCE_MERGE_WINDOW). Commits on its own: call it after the change is saved. A failure
        here is logged and doesn't undo the change."""
        if self.channel.announce_channel_id is None:
            return
        try:
            await self._announce(text, group)
        except Exception:
            await self.session.rollback()
            log.exception("Could not post the %s addon's system line", self.manifest.key)

    async def _announce(self, text: str, group: str) -> None:
        target = await self.session.get(Channel, self.channel.announce_channel_id)
        if target is None or target.type != ChannelType.text:
            return
        actor = self.access.user_id
        now = datetime.now(UTC)
        last = await self.session.scalar(
            select(Message).where(Message.channel_id == target.id).order_by(Message.id.desc()).limit(1).with_for_update(of=Message)
        )
        prev = last.system if last is not None else None
        if (
            last is not None
            and prev is not None
            and last.author_id == actor
            and prev.get("source_channel_id") == str(self.channel.id)
            and prev.get("group") == group
            and len(prev.get("lines", [])) < ANNOUNCE_MAX_LINES
            and now - datetime.fromisoformat(prev["last_at"]) < ANNOUNCE_MERGE_WINDOW
        ):
            message, event = last, "message.updated"
            message.system = {**prev, "lines": [*prev["lines"], text], "last_at": now.isoformat()}
        else:
            system = {
                "addon_key": self.manifest.key,
                "source_channel_id": str(self.channel.id),
                "group": group,
                "lines": [text],
                "last_at": now.isoformat(),
            }
            message, event = Message(channel_id=target.id, author_id=actor, content="", attachments=[], system=system), "message.created"
            self.session.add(message)
        await self.session.commit()
        await self.session.refresh(message, ["author"])
        payload: dict[str, Any] = {**MessageOut.model_validate(message).model_dump(mode="json"), "server_id": str(target.server_id)}
        if event == "message.created":
            payload["mentions"] = []
        await broker.publish(event, payload, await channel_viewers(self.session, target))


@dataclass
class AddonChat:
    """A chat (a server text channel, a DM or a group) as an addon that lives in chats sees it:
    each of its things is a message there (a poll). The workspace is the chat."""

    manifest: AddonManifest
    channel: Channel
    # The user's permissions in the server; None in DMs and groups.
    access: ServerAccess | None
    session: AsyncSession
    # None when the API acts by itself (an addon's worker): it can only publish and post lines.
    user_id: uuid.UUID | None

    @property
    def workspace_id(self) -> uuid.UUID:
        return self.channel.id

    @property
    def can_moderate(self) -> bool:
        """MANAGE_MESSAGES in a server channel. In DMs and groups nobody moderates."""
        return self.access is not None and bool(self.access.channel(self.channel) & Perm.MANAGE_MESSAGES)

    async def require_send(self) -> None:
        """What sending a message here takes: SEND_MESSAGES in a server, friendship in a 1:1 DM
        (never in the official DM)."""
        assert self.user_id is not None
        await require_dm_friends(self.session, self.channel, self.user_id)
        if self.access is not None:
            self.access.require_in(self.channel, Perm.SEND_MESSAGES)

    async def publish(self, event: str, data: dict[str, Any], user_ids: Iterable[uuid.UUID] | None = None) -> None:
        """Sends `addon.<key>.<event>` to everyone in the chat, or only to `user_ids` among them."""
        payload = {"channel_id": str(self.channel.id), "server_id": str(self.channel.server_id) if self.channel.server_id else None, **data}
        audience = await channel_audience(self.session, self.channel)
        if user_ids is not None:
            wanted = set(user_ids)
            audience = [u for u in audience if u in wanted]
        await broker.publish(f"addon.{self.manifest.key}.{event}", payload, audience)

    async def post(self, item_id: uuid.UUID, fallback: str, on_saved: Callable[[Message], None] | None = None) -> MessageOut:
        """Posts the message that shows the addon's thing (`item_id`), by the current user.
        `fallback` is its content, what apps that don't know the addon show. `on_saved` gets the
        message before the commit, to link the addon's row to it. Commits."""
        assert self.user_id is not None
        embed = {"addon_key": self.manifest.key, "id": str(item_id)}
        return await post_message(self.session, self.channel, self.user_id, fallback, embed=embed, on_saved=on_saved)

    async def system_line(self, text: str, *, author_id: uuid.UUID | None, message_id: int | None = None) -> None:
        """Posts a system line here, standing on its own ("Enquete encerrada: X venceu"); apps
        don't put the author's name before it (who did it, or whose thing it is; None for nobody).
        `message_id` is the message it's about. Commits.
        A failure is logged and doesn't undo what came before."""
        system: dict[str, Any] = {
            "addon_key": self.manifest.key,
            "source_channel_id": str(self.channel.id),
            "group": "line",
            "lines": [text],
            "last_at": datetime.now(UTC).isoformat(),
            "standalone": True,
        }
        if message_id is not None:
            system["message_id"] = message_id
        try:
            await post_message(self.session, self.channel, author_id, "", system=system)
        except Exception:
            await self.session.rollback()
            log.exception("Could not post the %s addon's system line", self.manifest.key)


async def addon_chat(session: AsyncSession, manifest: AddonManifest, channel_id: uuid.UUID, user_id: uuid.UUID) -> AddonChat:
    """The chat, if the user is in it (a channel they can see, a DM or group they're in). Others,
    and channels that hold no messages, are 404/400 like the message routes."""
    channel, access = await chat_channel(session, channel_id, user_id)
    return AddonChat(manifest, channel, access, session, user_id)


async def event_notice(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_ids: Iterable[uuid.UUID],
    message: str,
    *,
    key: str,
    title: str,
    item_id: uuid.UUID,
    starts_at: datetime,
    room_id: uuid.UUID | None = None,
    place: str | None = None,
) -> None:
    """An @aureum DM about an event to each of these users (category "eventos", which they can
    turn off), once per `key`. `message` names a text in the [dm] section of app/bot/mensagens.toml.
    The app shows the event's time in the user's own zone and, with `room_id`, a button to join
    the room. Never raises."""
    from app import bot

    users = list(dict.fromkeys(user_ids))
    channel = await session.get(Channel, workspace_id)
    if channel is None or not users:
        return
    local = f" em {bot.channel_mention(room_id)}" if room_id else f" em {place}" if place else ""
    try:
        content = bot.text("dm", message, titulo=title, local=local)
    except KeyError:
        log.exception("Unknown official message %s", message)
        return
    event = {
        "id": str(item_id),
        "channel_id": str(channel.id),
        "server_id": str(channel.server_id) if channel.server_id else None,
        "room_id": str(room_id) if room_id else None,
        "starts_at": starts_at.isoformat(),
    }
    await bot.event_notice(users, content, key=key, event=event)


async def addon_channel(
    session: AsyncSession, manifest: AddonManifest, channel_id: uuid.UUID, user_id: uuid.UUID, action: str = "view"
) -> AddonChannel:
    """The channel, if it runs this addon and the user may perform `action` there. Channels the
    user can't see, and channels of another kind, are 404."""
    channel, access = await get_channel_for_member(session, channel_id, user_id)
    if channel.type != ChannelType.addon or channel.addon_key != manifest.key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Channel not found")
    ctx = AddonChannel(manifest, channel, access, session)
    ctx.require(action)
    return ctx
