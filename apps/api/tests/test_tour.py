"""Tour and first-time tips (block 3.16): what the migration gives accounts older than the tour."""

import importlib.util
from pathlib import Path

from httpx import AsyncClient
from sqlalchemy import text

from app.db import engine
from tests.helpers import make_user

MIGRATION = Path(__file__).parent.parent / "alembic" / "versions" / "20261109_b8d4f0a2c375_onboarding.py"


async def test_accounts_older_than_the_tour_are_asked_first(client: AsyncClient) -> None:
    with_row = await make_user(client, "old_with_row")
    await with_row.patch("/users/me/settings", {"theme": "light"})
    without_row = await make_user(client, "old_without_row")

    spec = importlib.util.spec_from_file_location("migration", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    async with engine.begin() as conn:
        await conn.execute(text(module.BACKFILL))

    for user in (with_row, without_row):
        onboarding = (await user.get("/users/me/settings")).json()["onboarding"]
        assert onboarding == {"tour_version_done": 0, "tour_invite": True, "tips_seen": []}
    # The rest of the settings stays as it was.
    assert (await with_row.get("/users/me/settings")).json()["theme"] == "light"

    # Accounts created afterwards start the tour by themselves.
    fresh = await make_user(client, "fresh_account")
    assert (await fresh.get("/users/me/settings")).json()["onboarding"]["tour_invite"] is False
