"""The official bot, @aureum. No AI: fixed rules and ready-made messages (mensagens.toml).

It lives inside the API and reacts to what already happens there (someone joins the official
server, a bug report is resolved, a badge is granted, a password changes...). No separate
process and no token: it posts as the account named by AUREUM_BOT_USERNAME (default "aureum"),
which must be an official bot account (CLI `users create --oficial`). Without it, nothing runs.

- In official servers: the welcome and the public "bug confirmed" / "bug fixed" lines, each in
  the channel set with the CLI (`bot set-channel`). No channel, no post.
- New app releases: announced once in the avisos channel and as a "novidades" DM, as soon as
  they're published on GitHub (app/bot/releases.py).
- In each user's official DM (created with its first message): notices by category. The user can
  turn categories off, except security. The same notice never goes twice (bot_deliveries).
- Every action is switched with the CLI (`bot enable|disable`) and starts off.

The official look comes only from users.is_official / channels.is_official (set by the CLI and
by this module), never from what a message says. Errors here are logged and swallowed: a notice
that fails never breaks the request that caused it.
"""

import hashlib
import logging
import tomllib
import uuid
from collections.abc import Awaitable, Callable
from functools import cache
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import (
    BotAction,
    BotDelivery,
    BotWelcome,
    BugReport,
    Channel,
    ChannelMember,
    ChannelType,
    Message,
    Server,
    User,
    UserSettings,
)

log = logging.getLogger(__name__)

# Server actions: they post in the channel set for them.
WELCOME = "boas-vindas"
BUGS = "bugs"
NOTICES = "avisos"  # where `bot say` and the release announcements post
SERVER_ACTIONS = (WELCOME, BUGS, NOTICES)
# Announces each new app release (in the avisos channel and as a novidades DM).
RELEASES = "novidades"

# Official DM categories. Security can't be turned off by the user; the broadcast ones
# (avisos, novidades) go out through the broadcast queue (`bot broadcast`, release announcements).
SECURITY = "seguranca"
BADGES = "insignias"
BUG_DMS = "bugs"
INVITES = "convites"
NEWS = "novidades"
ANNOUNCEMENTS = "avisos"
# Reminders and changes of events the user said they're going to (the events addon).
EVENTS = "eventos"
CATEGORIES = (SECURITY, BADGES, BUG_DMS, INVITES, NEWS, ANNOUNCEMENTS, EVENTS)
BROADCAST_CATEGORIES = (ANNOUNCEMENTS, NEWS)
# DM actions switched with the CLI, one per category the bot sends by itself.
DM_ACTIONS = {f"dm-{c}": c for c in (SECURITY, BADGES, BUG_DMS, INVITES, EVENTS)}
ACTIONS = (*SERVER_ACTIONS, RELEASES, *DM_ACTIONS)

TITLE_MAX = 60


@cache
def messages() -> dict[str, dict[str, str]]:
    with (Path(__file__).parent / "mensagens.toml").open("rb") as f:
        return tomllib.load(f)


def text(section: str, name: str, **values: Any) -> str:
    return messages()[section][name].format(**values)


def mention(user: User) -> str:
    return f"@{user.username}"


def channel_mention(channel_id: uuid.UUID) -> str:
    """Rendered by the app as the channel's clickable #name."""
    return f"<#{channel_id}>"


def bug_title(report: BugReport) -> str:
    """Bug reports have no title: the first line of the description, shortened."""
    first = report.description.strip().splitlines()[0].strip() if report.description.strip() else "sem título"
    return first if len(first) <= TITLE_MAX else first[: TITLE_MAX - 1].rstrip() + "…"


# --- Configuration -------------------------------------------------------------------------


async def bot_user(session: AsyncSession) -> User | None:
    """The @aureum account, only if it really is an official bot account."""
    name = get_settings().aureum_bot_username
    user = await session.scalar(select(User).where(User.username == name)) if name else None
    return user if user is not None and user.is_official and user.is_bot else None


async def action(session: AsyncSession, name: str) -> BotAction:
    return await session.get(BotAction, name) or BotAction(action=name, enabled=False)


async def enabled(session: AsyncSession, name: str) -> bool:
    return (await action(session, name)).enabled


async def set_action(session: AsyncSession, name: str, *, enabled: bool | None = None, channel_id: uuid.UUID | None = None) -> BotAction:
    """Not committed."""
    row = await session.get(BotAction, name)
    if row is None:
        row = BotAction(action=name, enabled=False)
        session.add(row)
    if enabled is not None:
        row.enabled = enabled
    if channel_id is not None:
        row.channel_id = channel_id
    return row


async def official_text_channel(session: AsyncSession, channel_id: uuid.UUID) -> Channel | None:
    """A text channel of an official server: the only places the bot posts in a server."""
    channel = await session.get(Channel, channel_id)
    if channel is None or channel.type != ChannelType.text or channel.server_id is None:
        return None
    server = await session.get(Server, channel.server_id)
    return channel if server is not None and server.is_official else None


async def server_channel(session: AsyncSession, name: str) -> Channel | None:
    """The channel of a server action, when the action is on and its channel still qualifies."""
    row = await action(session, name)
    if not row.enabled or row.channel_id is None:
        return None
    return await official_text_channel(session, row.channel_id)


# --- Posting -------------------------------------------------------------------------------


async def post(session: AsyncSession, bot_id: uuid.UUID, channel: Channel, content: str, official: dict[str, Any]) -> Message:
    """Posts as @aureum and sends it live, like a member's message. Commits."""
    from app import dms, reads
    from app.access import channel_audience
    from app.realtime import broker
    from app.schemas import MessageOut

    if channel.server_id is None:
        await dms.reveal(session, channel)
    message = Message(channel_id=channel.id, author_id=bot_id, content=content, attachments=[], official=official)
    session.add(message)
    await session.flush()
    audience = await channel_audience(session, channel)
    mentioned = await reads.record_mentions(session, message, audience) if channel.server_id else []
    await session.commit()
    await session.refresh(message, ["author"])
    event = {
        **MessageOut.model_validate(message).model_dump(mode="json"),
        "server_id": str(channel.server_id) if channel.server_id else None,
        "mentions": [str(u) for u in mentioned],
    }
    await broker.publish("message.created", event, audience)
    return message


async def official_dm(session: AsyncSession, bot_id: uuid.UUID, user_id: uuid.UUID) -> Channel:
    """The user's official DM, created on its first message. Commits when it creates it."""
    from app import dms

    key = dms.dm_key(bot_id, user_id)
    channel = await session.scalar(select(Channel).where(Channel.dm_key == key))
    if channel is not None:
        if not channel.is_official:
            channel.is_official = True
            await session.commit()
        return channel
    channel = Channel(type=ChannelType.dm, dm_key=key, is_official=True)
    session.add(channel)
    await session.flush()
    # The bot never reads it: its side stays closed.
    session.add_all([ChannelMember(channel_id=channel.id, user_id=user_id), ChannelMember(channel_id=channel.id, user_id=bot_id, hidden=True)])
    try:
        await session.commit()
    except IntegrityError:  # created at the same moment by another notice
        await session.rollback()
        found = await session.scalar(select(Channel).where(Channel.dm_key == key))
        assert found is not None
        return found
    await dms.announce(session, channel, [user_id], "dm.created")
    return channel


async def accepts(session: AsyncSession, user: User, category: str) -> bool:
    """Whether the user gets this category (security always)."""
    if category == SECURITY:
        return True
    prefs = await session.get(UserSettings, user.id)
    return not prefs or prefs.official_dm.get(category, True) is not False


async def send_dm(
    session: AsyncSession, user: User, category: str, content: str, *, key: str | None = None, badge: str | None = None,
    also_delivers: tuple[str, ...] = (), extra: dict[str, Any] | None = None,
) -> bool:
    """Sends an official DM if the user accepts the category and hasn't had this one (`key`)
    yet. `also_delivers` marks other keys as delivered with it (a bug DM that also announces the
    badge). `extra` goes into the message's `official` (what the app shows with it, like an
    event's buttons). Commits. Returns whether it went out."""
    bot = await bot_user(session)
    if bot is None or user.id == bot.id or user.is_official or not await accepts(session, user, category):
        return False
    key = key or f"once:{uuid.uuid4()}"
    claimed = await session.scalar(
        insert(BotDelivery).values(user_id=user.id, key=key).on_conflict_do_nothing().returning(BotDelivery.key)
    )
    if claimed is None:  # already sent (nothing was written)
        return False
    for other in also_delivers:
        await session.execute(insert(BotDelivery).values(user_id=user.id, key=other).on_conflict_do_nothing())
    bot_id, user_id = bot.id, user.id
    await session.commit()  # the delivery is claimed before posting: never twice, even on a retry
    channel = await official_dm(session, bot_id, user_id)
    official: dict[str, Any] = {**(extra or {}), "category": category}
    if badge:
        official["badge"] = badge
    await post(session, bot_id, channel, content, official)
    return True



# --- Reactions to what happens in the API -------------------------------------------------
# Called after the request's own commit, with ids. Each runs in its own database session, so
# the request's session and objects are never touched, and never raises: a notice that fails
# is logged and the request goes on.


async def _run(what: str, work: Callable[[AsyncSession], Awaitable[None]]) -> None:
    from app.db import SessionLocal

    try:
        async with SessionLocal() as session:
            await work(session)
    except Exception:
        log.exception("Bot: %s failed", what)


async def welcome(server_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """The welcome in an official server: once per person, even if they leave and come back."""

    async def work(session: AsyncSession) -> None:
        from app import badges

        channel = await server_channel(session, WELCOME)
        if channel is None or channel.server_id != server_id:
            return
        bot = await bot_user(session)
        user = await session.get(User, user_id)
        if bot is None or user is None or user.is_official:
            return
        first = await session.scalar(
            insert(BotWelcome).values(server_id=server_id, user_id=user_id).on_conflict_do_nothing().returning(BotWelcome.user_id)
        )
        if first is None:  # welcomed before
            return
        number = next((g.number for g in user.badge_grants if g.badge.key == badges.PIONEER), None)
        content = (
            text("servidor", "boas_vindas", mencao=mention(user), numero=number)
            if number is not None
            else text("servidor", "boas_vindas_sem_pioneiro", mencao=mention(user))
        )
        bugs = await server_channel(session, BUGS)
        if bugs is not None and bugs.server_id == server_id:
            content += text("servidor", "boas_vindas_bugs", canal_bugs=channel_mention(bugs.id))
        await post(session, bot.id, channel, content, {"category": "boas-vindas"})

    await _run("welcome", work)


async def bug_confirmed(report_id: uuid.UUID) -> None:
    """"Confirmar bug": the public "we're on it" line and the author's DM (once per report)."""

    async def work(session: AsyncSession) -> None:
        report = await session.get(BugReport, report_id)
        author = await session.get(User, report.author_id) if report and report.author_id else None
        if report is None or author is None:
            return
        title = bug_title(report)
        channel = await server_channel(session, BUGS)
        bot = await bot_user(session)
        if channel is not None and bot is not None and not author.is_official:
            content = text("servidor", "bug_confirmado", titulo=title, mencao=mention(author))
            await post(session, bot.id, channel, content, {"category": "bugs"})
        if await enabled(session, "dm-bugs"):
            await send_dm(session, author, BUG_DMS, text("dm", "bug_confirmado", titulo=title), key=f"bug-confirmed:{report_id}")

    await _run("bug confirmed", work)


async def bug_resolved(report_id: uuid.UUID, badge_granted: bool) -> None:
    """The public line in the bugs channel and the author's DM (with the badge the first time)."""

    async def work(session: AsyncSession) -> None:
        from app import badges

        report = await session.get(BugReport, report_id)
        author = await session.get(User, report.author_id) if report and report.author_id else None
        if report is None or author is None:
            return
        title = bug_title(report)
        channel = await server_channel(session, BUGS)
        bot = await bot_user(session)
        if channel is not None and bot is not None and not author.is_official:
            content = text("servidor", "bug_resolvido", titulo=title, mencao=mention(author))
            await post(session, bot.id, channel, content, {"category": "bugs"})
        if not await enabled(session, "dm-bugs"):
            return
        if badge_granted:
            name = badges.BADGES[badges.BUG_HUNTER].name
            await send_dm(
                session, author, BUG_DMS, text("dm", "bug_resolvido_insignia", titulo=title, insignia=name),
                key=f"bug:{report_id}", badge=badges.BUG_HUNTER, also_delivers=(f"badge:{badges.BUG_HUNTER}",),
            )
        else:
            await send_dm(session, author, BUG_DMS, text("dm", "bug_resolvido", titulo=title), key=f"bug:{report_id}")

    await _run("bug resolved", work)


async def badge_granted(user_id: uuid.UUID, key: str) -> None:
    async def work(session: AsyncSession) -> None:
        from app import badges

        user = await session.get(User, user_id)
        if user is None or key not in badges.BADGES or not await enabled(session, "dm-insignias"):
            return
        name = badges.BADGES[key].name
        await send_dm(session, user, BADGES, text("dm", "insignia", insignia=name), key=f"badge:{key}", badge=key)

    await _run("badge notice", work)


async def invite_used(inviter_id: uuid.UUID, newcomer_id: uuid.UUID) -> None:
    """To whoever invited, once the newcomer confirms their e-mail."""

    async def work(session: AsyncSession) -> None:
        inviter = await session.get(User, inviter_id)
        newcomer = await session.get(User, newcomer_id)
        if inviter is None or newcomer is None or not await enabled(session, "dm-convites"):
            return
        await send_dm(session, inviter, INVITES, text("dm", "convite", mencao=mention(newcomer)), key=f"invite:{newcomer_id}")

    await _run("invite notice", work)


async def event_notice(user_ids: list[uuid.UUID], content: str, *, key: str, event: dict[str, Any]) -> None:
    """An events addon notice (a reminder, a change, a cancellation) to each of these users, once
    per `key`. `event` tells the app which event and room it's about."""

    async def work(session: AsyncSession) -> None:
        if not await enabled(session, f"dm-{EVENTS}"):
            return
        for user_id in user_ids:
            user = await session.get(User, user_id)
            if user is not None:
                await send_dm(session, user, EVENTS, content, key=key, extra={"event": event})

    await _run("event notice", work)


async def security(user_id: uuid.UUID, kind: str, **values: str) -> None:
    """kind: "senha", "email" (novo=) or "login" (sistema=). Always a new notice."""

    async def work(session: AsyncSession) -> None:
        from app import mail

        user = await session.get(User, user_id)
        if user is None or not await enabled(session, "dm-seguranca"):
            return
        await send_dm(session, user, SECURITY, text("dm", f"seguranca_{kind}", quando=mail.when(), **values))

    await _run("security notice", work)


# --- New sign-ins --------------------------------------------------------------------------


def device_hash(user_id: uuid.UUID, device_id: str) -> str:
    """Only this hash is kept: the app's id can't be read back from it, nor linked across accounts."""
    return hashlib.sha256(f"{user_id}:{device_id}".encode()).hexdigest()


async def seen_device(user_id: uuid.UUID, device_id: str | None) -> bool:
    """Records the install; True when it's new to an account that already had others (a sign-in
    worth a security notice). The first install ever recorded is never "new", or everyone would
    get a notice the first time they update. Its own session, like the reactions."""
    from app.db import SessionLocal
    from app.models import UserDevice

    if not device_id:
        return False
    async with SessionLocal() as session:
        known = await session.scalar(select(UserDevice.device_hash).where(UserDevice.user_id == user_id).limit(1))
        added = await session.scalar(
            insert(UserDevice)
            .values(user_id=user_id, device_hash=device_hash(user_id, device_id))
            .on_conflict_do_nothing()
            .returning(UserDevice.device_hash)
        )
        await session.commit()
    return added is not None and known is not None
