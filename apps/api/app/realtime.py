"""Real-time events and presence.

Every event is published to Redis together with the ids of the users who should receive
it. Each API process subscribes to the channel and forwards events to the WebSockets it
holds locally, so any number of API processes can run side by side.

A few high-volume events (screen-share thumbnails) go to connections instead of users:
only those currently watching a server's overview (and, when given, only of some users).
"""

import asyncio
import contextlib
import json
import logging
import time
import uuid
from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from fastapi import WebSocket
from redis.asyncio import Redis

from app.config import get_settings

log = logging.getLogger(__name__)

PRESENCE_TTL_SECONDS = 90  # a connection counts as online this long after its last heartbeat


class Broker:
    def __init__(self) -> None:
        settings = get_settings()
        self._url = settings.redis_url
        self._channel = f"{settings.redis_prefix}:events"
        self._presence_prefix = f"{settings.redis_prefix}:presence"
        self._redis: Redis | None = None
        self._listener: asyncio.Task[None] | None = None
        self._subscribed = asyncio.Event()
        self._sockets: dict[uuid.UUID, set[WebSocket]] = defaultdict(set)
        self._owners: dict[WebSocket, uuid.UUID] = {}
        # Connections showing a server's overview, by server id.
        self._watchers: dict[uuid.UUID, set[WebSocket]] = defaultdict(set)

    @property
    def redis(self) -> Redis:
        if self._redis is None:
            self._redis = Redis.from_url(self._url, decode_responses=True)
        return self._redis

    # -- events -------------------------------------------------------------

    async def publish(self, type_: str, data: Any, user_ids: Iterable[uuid.UUID]) -> None:
        recipients = [str(u) for u in set(user_ids)]
        if not recipients:
            return
        payload = json.dumps({"type": type_, "data": data, "user_ids": recipients}, default=str)
        try:
            await self.redis.publish(self._channel, payload)
        except Exception:  # an event lost to a Redis outage must not fail the HTTP request
            log.exception("Failed to publish %s event", type_)

    async def publish_to_watchers(
        self, type_: str, data: Any, server_id: uuid.UUID, user_ids: Iterable[uuid.UUID] | None = None
    ) -> None:
        """Sends an event only to connections watching the server's overview, optionally only
        those of some users (e.g. who can see the channel it's about)."""
        message: dict[str, Any] = {"type": type_, "data": data, "watchers": str(server_id)}
        if user_ids is not None:
            message["user_ids"] = [str(u) for u in set(user_ids)]
        payload = json.dumps(message, default=str)
        try:
            await self.redis.publish(self._channel, payload)
        except Exception:
            log.exception("Failed to publish %s event", type_)

    async def ensure_listening(self) -> None:
        if self._listener is None or self._listener.done():
            self._subscribed.clear()
            self._listener = asyncio.create_task(self._listen())
        await self._subscribed.wait()

    async def _listen(self) -> None:
        backoff = 1.0
        while True:
            try:
                pubsub = self.redis.pubsub()
                await pubsub.subscribe(self._channel)
                self._subscribed.set()
                backoff = 1.0
                async for message in pubsub.listen():
                    if message["type"] == "message":
                        await self._deliver(json.loads(message["data"]))
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Redis subscriber failed; retrying in %.0fs", backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    async def _deliver(self, payload: dict[str, Any]) -> None:
        event = {"type": payload["type"], "data": payload["data"]}
        if "watchers" in payload:
            watchers = self._watchers.get(uuid.UUID(payload["watchers"]), set())
            allowed = {uuid.UUID(u) for u in payload["user_ids"]} if "user_ids" in payload else None
            for ws in list(watchers):
                if allowed is not None and self._owners.get(ws) not in allowed:
                    continue
                try:
                    await ws.send_json(event)
                except Exception:
                    watchers.discard(ws)
            return
        for user_id in payload["user_ids"]:
            for ws in list(self._sockets.get(uuid.UUID(user_id), ())):
                try:
                    await ws.send_json(event)
                except Exception:
                    self._sockets[uuid.UUID(user_id)].discard(ws)

    # -- connections & presence --------------------------------------------

    def register(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        self._sockets[user_id].add(ws)
        self._owners[ws] = user_id

    def unregister(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        self.watch(None, ws)
        self._owners.pop(ws, None)
        sockets = self._sockets.get(user_id)
        if sockets is not None:
            sockets.discard(ws)
            if not sockets:
                del self._sockets[user_id]

    def watch(self, server_id: uuid.UUID | None, ws: WebSocket) -> None:
        """A connection watches at most one server overview at a time (None: none)."""
        for sid in [sid for sid, sockets in self._watchers.items() if ws in sockets]:
            self._watchers[sid].discard(ws)
            if not self._watchers[sid]:
                del self._watchers[sid]
        if server_id is not None:
            self._watchers[server_id].add(ws)

    def presence_key(self, user_id: uuid.UUID) -> str:
        return f"{self._presence_prefix}:{user_id}"

    async def heartbeat(self, user_id: uuid.UUID, connection_id: str) -> bool:
        """Marks a connection alive. Returns True if the user just came online."""
        key = self.presence_key(user_id)
        now = time.time()
        async with self.redis.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(key, "-inf", now)
            pipe.zcard(key)
            pipe.zadd(key, {connection_id: now + PRESENCE_TTL_SECONDS})
            pipe.expire(key, PRESENCE_TTL_SECONDS)
            _, before, *_ = await pipe.execute()
        return before == 0

    async def disconnect(self, user_id: uuid.UUID, connection_id: str) -> bool:
        """Drops a connection. Returns True if the user is now offline."""
        key = self.presence_key(user_id)
        async with self.redis.pipeline(transaction=True) as pipe:
            pipe.zrem(key, connection_id)
            pipe.zcount(key, time.time(), "+inf")
            _, remaining = await pipe.execute()
        return remaining == 0

    async def online(self, user_ids: Iterable[uuid.UUID]) -> set[uuid.UUID]:
        ids = list(user_ids)
        if not ids:
            return set()
        now = time.time()
        try:
            async with self.redis.pipeline(transaction=False) as pipe:
                for user_id in ids:
                    pipe.zcount(self.presence_key(user_id), now, "+inf")
                counts = await pipe.execute()
        except Exception:
            log.exception("Failed to read presence")
            return set()
        return {u for u, c in zip(ids, counts, strict=True) if c > 0}

    async def close(self) -> None:
        if self._listener is not None:
            self._listener.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listener
            self._listener = None
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None


broker = Broker()
