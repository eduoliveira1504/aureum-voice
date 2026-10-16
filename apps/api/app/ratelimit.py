"""Fixed-window rate limiting on Redis, for login and registration."""

import logging

from fastapi import HTTPException, Request, status

from app.config import get_settings
from app.realtime import broker

log = logging.getLogger(__name__)


def client_ip(request: Request) -> str:
    """The caller's IP. Behind a reverse proxy (Tailscale Funnel, Caddy) every request comes
    from the proxy, so the real IP is the LAST X-Forwarded-For entry — the one the proxy
    appended. Earlier entries are client-controlled and never trusted."""
    if get_settings().trust_forwarded_for:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def _key(name: str) -> str:
    return f"{get_settings().redis_prefix}:rl:{name}"


def _too_many(retry_after: int) -> HTTPException:
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many attempts. Try again later.",
        headers={"Retry-After": str(max(retry_after, 1))},
    )


async def hit(name: str, limit: int, window_seconds: int) -> None:
    """Counts one attempt; raises 429 once `limit` attempts happen within the window.
    Fails open if Redis is unavailable (logins shouldn't break because of the limiter)."""
    try:
        async with broker.redis.pipeline(transaction=True) as pipe:
            pipe.incr(_key(name))
            pipe.expire(_key(name), window_seconds, nx=True)
            pipe.ttl(_key(name))
            count, _, ttl = await pipe.execute()
    except Exception:
        log.exception("Rate limiter unavailable")
        return
    if count > limit:
        raise _too_many(ttl)


async def check(name: str, limit: int) -> None:
    """Raises 429 if a counter (e.g. failed logins) already reached its limit, without counting."""
    try:
        async with broker.redis.pipeline(transaction=False) as pipe:
            pipe.get(_key(name))
            pipe.ttl(_key(name))
            count, ttl = await pipe.execute()
    except Exception:
        log.exception("Rate limiter unavailable")
        return
    if count is not None and int(count) >= limit:
        raise _too_many(ttl)


async def reset(name: str) -> None:
    try:
        await broker.redis.delete(_key(name))
    except Exception:
        log.exception("Rate limiter unavailable")
