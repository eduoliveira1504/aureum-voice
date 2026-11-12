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
Only live connections count: an entry left behind by a connection that's gone (an API process
that died before cleaning up) is ignored and deleted. Apps that send a device id re-confirm
their activity every couple of minutes, and theirs expires without it; the sweeper takes
expired and orphaned entries out and tells everyone. At startup no connection survives, so
every stored activity is dropped.
"""

import asyncio
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

# An activity that is re-confirmed (apps with a device id do it every 2 minutes) lasts this long
# without a new report.
ACTIVITY_TTL_SECONDS = 300
ACTIVITY_SWEEP_SECONDS = 30


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


async def set_activity(user_id: uuid.UUID, connection_id: str, name: str | None, *, expires: bool = False) -> None:
    """Records what a connection is playing (None: nothing). The start time is kept while
    the name stays the same, so "for 2h" survives repeated reports. With `expires` (an app that
    re-confirms it), each report extends it by ACTIVITY_TTL_SECONDS."""
    key = _key("activity", user_id)
    if name is None:
        await broker.redis.hdel(key, connection_id)
        return
    previous = await broker.redis.hget(key, connection_id)
    started_at = datetime.now(UTC).isoformat()
    if previous is not None and (old := json.loads(previous)).get("name") == name:
        if not expires:
            return
        started_at = old["started_at"]
    activity: dict[str, Any] = {"type": "playing", "name": name, "started_at": started_at}
    if expires:
        activity["expires_at"] = time.time() + ACTIVITY_TTL_SECONDS
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


async def _current(user_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict[str, Any]]:
    """Each user's activity from their live, unexpired entries; the others are deleted."""
    now = time.time()
    async with broker.redis.pipeline(transaction=False) as pipe:
        for user_id in user_ids:
            pipe.hgetall(_key("activity", user_id))
            pipe.zrangebyscore(broker.presence_key(user_id), now, "+inf")
        raw = await pipe.execute()
    found: dict[uuid.UUID, dict[str, Any]] = {}
    for i, user_id in enumerate(user_ids):
        entries, alive = raw[2 * i], set(raw[2 * i + 1])
        valid = []
        stale = []
        for connection_id, value in entries.items():
            activity = json.loads(value)
            if connection_id in alive and activity.get("expires_at", now + 1) > now:
                valid.append({k: v for k, v in activity.items() if k != "expires_at"})
            else:
                stale.append(connection_id)
        if stale:
            await broker.redis.hdel(_key("activity", user_id), *stale)
        if valid:
            found[user_id] = max(valid, key=lambda a: a["started_at"])
    return found


async def activities(user_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, dict[str, Any]]:
    """Visible activity per user, only for users who have one and aren't offline."""
    ids = list(dict.fromkeys(user_ids))
    if not ids:
        return {}
    try:
        found = await _current(ids)
    except Exception:
        log.exception("Failed to read activities")
        return {}
    visible = await statuses(found)
    return {user_id: a for user_id, a in found.items() if visible[user_id] != "offline"}


def _activity_prefix() -> str:
    return _key("activity", uuid.UUID(int=0))[: -len(str(uuid.UUID(int=0)))]


async def sweep_activities() -> None:
    """Takes out expired and orphaned activities, telling everyone who sees those users."""
    prefix = _activity_prefix()
    async for key in broker.redis.scan_iter(match=f"{prefix}*"):
        try:
            await announce_activity(uuid.UUID(key[len(prefix) :]))  # reading drops stale entries
        except Exception:
            log.exception("Presence: could not sweep an activity")


async def run_activity_sweeper() -> None:
    """Runs for the life of the API process. Starts by dropping every stored activity: after a
    restart no connection is left, and the apps re-send theirs when they reconnect."""
    async for key in broker.redis.scan_iter(match=f"{_activity_prefix()}*"):
        await broker.redis.delete(key)
    while True:
        await asyncio.sleep(ACTIVITY_SWEEP_SECONDS)
        try:
            await sweep_activities()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Presence: activity sweep failed")


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
