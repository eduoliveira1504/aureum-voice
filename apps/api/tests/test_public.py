"""The landing page's read-only numbers: GET /api/public/stats."""

import uuid

import pytest
from httpx import AsyncClient

from app import badges
from app.config import get_settings
from app.db import SessionLocal
from app.models import User
from app.routers import public
from tests.helpers import make_user

LANDING = "https://eduoliveira1504.github.io"


@pytest.fixture(autouse=True)
def fresh_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(public, "_cache", None)
    monkeypatch.setattr(get_settings(), "aureum_beta", True)  # Pioneiro is only handed out in the beta


async def grant(user_id: str, key: str) -> None:
    async with SessionLocal() as session:
        user = await session.get(User, uuid.UUID(user_id))
        await badges.grant(session, user, key)
        await session.commit()


async def test_counts_pioneers_and_nothing_else(client: AsyncClient) -> None:
    for name in ("mari", "lucas"):
        await grant((await make_user(client, name)).id, badges.PIONEER)
    await make_user(client, "bia")  # no badge

    res = await client.get("/api/public/stats", headers={"Origin": LANDING})
    assert res.status_code == 200
    assert res.json() == {"pioneers": 2}
    assert res.headers["access-control-allow-origin"] == LANDING
    assert res.headers["cache-control"] == "public, max-age=300"


async def test_is_cached_for_five_minutes(client: AsyncClient) -> None:
    assert (await client.get("/api/public/stats")).json() == {"pioneers": 0}
    await grant((await make_user(client, "mari")).id, badges.PIONEER)
    assert (await client.get("/api/public/stats")).json() == {"pioneers": 0}

    public._cache = None  # the five minutes are up
    assert (await client.get("/api/public/stats")).json() == {"pioneers": 1}


async def test_other_origins_get_no_cors_header(client: AsyncClient) -> None:
    res = await client.get("/api/public/stats", headers={"Origin": "https://evil.example"})
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") != "https://evil.example"


async def test_is_rate_limited_per_ip(client: AsyncClient) -> None:
    limit, _ = public.LOOKUPS_PER_IP
    for _ in range(limit):
        assert (await client.get("/api/public/stats")).status_code == 200
    res = await client.get("/api/public/stats")
    assert res.status_code == 429 and "retry-after" in res.headers
