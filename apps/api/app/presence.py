"""What others see of a user: online, idle, do not disturb or offline.

It combines the live connections (realtime.Broker), the status the user picked (kept in
user_settings and mirrored in Redis) and idleness: each connection reports when its PC has had
no input for a while, and the user shows as idle once all their connections are. Invisible
users show as offline. Bot accounts (the official @aureum) have no connection but are always
there: they always show as online.

`presence.updated` goes out only when the visible status actually changes.

Activities ("Jogando X") live here too: each connection reports the game its PC is running
(only the name), and the user's activity is the most recently started one. They're never
stored in the database and vanish with the connection; offline/invisible users have none.
"""

import json
import logging
import time
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select

from app.access import audience_ids
from app.config import get_settings
from app.db import SessionLocal
from app.models import User, UserStatus
from app.realtime import broker
from app.schemas import Presence

log = logging.getLogger(__name__)


def _key(kind: str, user_id: uuid.UUID) -> str:
    return f"{get_settings().redis_prefix}:presence-{kind}:{user_id}"


async def set_chosen(user_id: uuid.UUID, status: UserStatus) -> None:
    await broker.redis.set(_key("chosen", user_id), status.value)


async def set_idle(user_id: uuid.UUID, connection_id: str, idle: bool) -> None:
    key = _key("idle", user_id)
    if idle:
        await broker.redis.sadd(key, connection_id)
    else:
        await broker.redis.srem(key, connection_id)


async def forget_connection(user_id: uuid.UUID, connection_id: str) -> None:
    await broker.redis.srem(_key("idle", user_id), connection_id)
    await broker.redis.hdel(_key("activity", user_id), connection_id)


async def set_activity(user_id: uuid.UUID, connection_id: str, name: str | None) -> None:
    """Records what a connection is playing (None: nothing). The start time is kept while
    the name stays the same, so "for 2h" survives repeated reports."""
    key = _key("activity", user_id)
    if name is None:
        await broker.redis.hdel(key, connection_id)
        return
    previous = await broker.redis.hget(key, connection_id)
    if previous is not None and json.loads(previous).get("name") == name:
        return
    activity = {"type": "playing", "name": name, "started_at": datetime.now(UTC).isoformat()}
    await broker.redis.hset(key, connection_id, json.dumps(activity))


def _visible(alive: list[str], idle: set[str], chosen: str | None) -> Presence:
    if not alive or chosen == UserStatus.invisible.value:
        return "offline"
    if chosen == UserStatus.dnd.value:
        return "dnd"
    if chosen == UserStatus.idle.value or all(c in idle for c in alive):
        return "idle"
    return "online"


async def _bots(ids: list[uuid.UUID]) -> set[uuid.UUID]:
    async with SessionLocal() as session:
        return set(await session.scalars(select(User.id).where(User.id.in_(ids), User.is_bot.is_(True))))


async def _live(ids: list[uuid.UUID]) -> dict[uuid.UUID, Presence]:
    """Visible status from the live connections; offline for anyone without one."""
    if not ids:
        return {}
    now = time.time()
    try:
        async with broker.redis.pipeline(transaction=False) as pipe:
            for user_id in ids:
                pipe.zrangebyscore(broker.presence_key(user_id), now, "+inf")
                pipe.smembers(_key("idle", user_id))
                pipe.get(_key("chosen", user_id))
            raw = await pipe.execute()
    except Exception:
        log.exception("Failed to read presence")
        return dict.fromkeys(ids, "offline")
    return {
        user_id: _visible(raw[3 * i], set(raw[3 * i + 1]), raw[3 * i + 2])
        for i, user_id in enumerate(ids)
    }


async def statuses(user_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, Presence]:
    """Visible status per user: from the live connections, and always online for bots."""
    ids = list(dict.fromkeys(user_ids))
    if not ids:
        return {}
    bots = await _bots(ids)
    people = await _live([u for u in ids if u not in bots])
    return {u: "online" if u in bots else people[u] for u in ids}


async def activities(user_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, dict[str, Any]]:
    """Visible activity per user, only for users who have one and aren't offline."""
    ids = list(dict.fromkeys(user_ids))
    if not ids:
        return {}
    try:
        async with broker.redis.pipeline(transaction=False) as pipe:
            for user_id in ids:
                pipe.hvals(_key("activity", user_id))
            raw = await pipe.execute()
    except Exception:
        log.exception("Failed to read activities")
        return {}
    found = {
        user_id: max((json.loads(v) for v in values), key=lambda a: a["started_at"])
        for user_id, values in zip(ids, raw, strict=True)
        if values
    }
    visible = await statuses(found)
    return {user_id: a for user_id, a in found.items() if visible[user_id] != "offline"}


async def announce_activity(user_id: uuid.UUID) -> None:
    """Sends activity.updated to everyone who sees the user, if their visible activity changed."""
    activity = (await activities([user_id])).get(user_id)
    encoded = json.dumps(activity)
    if await broker.redis.getset(_key("last-activity", user_id), encoded) == encoded:
        return
    async with SessionLocal() as session:
        recipients = await audience_ids(session, user_id)
    await broker.publish("activity.updated", {"user_id": str(user_id), "activity": activity}, recipients)


async def changed(user_id: uuid.UUID) -> Presence | None:
    """The user's visible status if it differs from the last one announced, else None."""
    status = (await statuses([user_id]))[user_id]
    previous = await broker.redis.getset(_key("last", user_id), status)
    return status if previous != status else None


async def announce(user_id: uuid.UUID) -> None:
    """Sends presence.updated to everyone who sees the user, if their visible status changed."""
    status = await changed(user_id)
    if status is None:
        return
    async with SessionLocal() as session:
        recipients = await audience_ids(session, user_id)
    # Going offline/invisible hides the activity, coming back shows it again.
    activity = (await activities([user_id])).get(user_id)
    await broker.redis.set(_key("last-activity", user_id), json.dumps(activity))
    data = {"user_id": str(user_id), "status": status, "online": status != "offline", "activity": activity}
    await broker.publish("presence.updated", data, recipients)
