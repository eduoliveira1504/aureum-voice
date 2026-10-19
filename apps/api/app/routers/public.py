"""Read-only numbers for the landing page (GitHub Pages). Only aggregate counts, never anything
about a person. It's the one route another origin may read, so it sets its own CORS header
instead of widening the app-wide CORS list."""

import time

from fastapi import APIRouter, Request, Response
from sqlalchemy import func, select

from app import ratelimit
from app.badges import PIONEER
from app.config import get_settings
from app.deps import SessionDep
from app.models import Badge, UserBadge
from app.schemas import PublicStats

CACHE_SECONDS = 300
LOOKUPS_PER_IP = (30, 60)

router = APIRouter(prefix="/public", tags=["public"])

# (expires at, stats). One process serves the API, so a module-level cache is enough.
_cache: tuple[float, PublicStats] | None = None


async def _count(session: SessionDep) -> PublicStats:
    pioneers = await session.scalar(
        select(func.count()).select_from(UserBadge).join(Badge).where(Badge.key == PIONEER)
    )
    return PublicStats(pioneers=pioneers or 0)


@router.get("/stats", response_model=PublicStats)
async def stats(request: Request, response: Response, session: SessionDep) -> PublicStats:
    """How many people hold the Pioneiro badge, cached for 5 minutes."""
    global _cache
    await ratelimit.hit(f"public-stats:{ratelimit.client_ip(request)}", *LOOKUPS_PER_IP)
    now = time.monotonic()
    if _cache is None or _cache[0] <= now:
        _cache = (now + CACHE_SECONDS, await _count(session))
    response.headers["Cache-Control"] = f"public, max-age={CACHE_SECONDS}"
    origin = get_settings().public_site_origin
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    return _cache[1]
