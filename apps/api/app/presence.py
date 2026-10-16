"""What others see of a user: online, idle, do not disturb or offline.

It combines the live connections (realtime.Broker), the status the user picked (kept in
user_settings and mirrored in Redis) and idleness: each connection reports when its PC has had
no input for a while, and the user shows as idle once all their connections are. Invisible
users show as offline.

`presence.updated` goes out only when the visible status actually changes.
"""

import logging
import time
import uuid
from collections.abc import Iterable

from app.access import audience_ids
from app.config import get_settings
from app.db import SessionLocal
from app.models import UserStatus
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


def _visible(alive: list[str], idle: set[str], chosen: str | None) -> Presence:
    if not alive or chosen == UserStatus.invisible.value:
        return "offline"
    if chosen == UserStatus.dnd.value:
        return "dnd"
    if chosen == UserStatus.idle.value or all(c in idle for c in alive):
        return "idle"
    return "online"


async def statuses(user_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, Presence]:
    """Visible status per user; offline for anyone without a live connection."""
    ids = list(dict.fromkeys(user_ids))
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
    data = {"user_id": str(user_id), "status": status, "online": status != "offline"}
    await broker.publish("presence.updated", data, recipients)
