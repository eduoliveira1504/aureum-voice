"""Channel categories (block 3.12)."""

import importlib.util
from pathlib import Path
from typing import Any

from httpx import AsyncClient
from sqlalchemy import text

from app.db import engine
from app.permissions import Perm
from tests.helpers import make_server, make_user

MIGRATION = Path(__file__).parent.parent / "alembic" / "versions" / "20261101_d2f8b4c0e631_channel_categories.py"


def names(server: dict[str, Any]) -> list[str]:
    return [c["name"] for c in sorted(server["categories"], key=lambda c: c["position"])]


async def test_new_server_has_the_three_categories(client: AsyncClient) -> None:
    owner = await make_user(client, "ana")
    server = await make_server(owner)
    assert names(server) == ["Salas", "Conversas", "Addons"]
    by_id = {c["id"]: c["name"] for c in server["categories"]}
    assert {c["type"]: by_id[c["category_id"]] for c in server["channels"]} == {"text": "Conversas", "voice": "Salas"}


async def test_migration_keeps_channels_in_order_inside_their_category(client: AsyncClient) -> None:
    owner = await make_user(client, "ana")
    server = await make_server(owner)
    sid = server["id"]
    for name, type_ in [("sala-2", "voice"), ("outro", "text"), ("sala-3", "voice")]:
        assert (await owner.post(f"/servers/{sid}/channels", {"name": name, "type": type_})).status_code == 201
    before = (await owner.get(f"/servers/{sid}")).json()["channels"]
    private = next(c for c in before if c["name"] == "outro")
    role = (await owner.post(f"/servers/{sid}/roles", {"name": "Mod"})).json()
    res = await owner.put(f"/channels/{private['id']}/overrides/role/{role['id']}", {"allow": 0, "deny": int(Perm.VIEW_CHANNEL)})
    assert res.status_code == 200, res.text

    # As a server looked before the migration.
    spec = importlib.util.spec_from_file_location("migration", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE channels SET category_id = NULL, permissions_synced = true WHERE server_id = :s"), {"s": sid})
        await conn.execute(text("DELETE FROM channel_categories WHERE server_id = :s"), {"s": sid})
        for statement in module.BACKFILL:
            await conn.execute(text(statement))

    after = (await owner.get(f"/servers/{sid}")).json()
    assert names(after) == ["Salas", "Conversas", "Addons"]
    by_id = {c["id"]: c["name"] for c in after["categories"]}
    assert [c["name"] for c in after["channels"]] == [c["name"] for c in before]
    assert all(by_id[c["category_id"]] == {"voice": "Salas", "text": "Conversas"}[c["type"]] for c in after["channels"])
    synced = {c["name"]: c["permissions_synced"] for c in after["channels"]}
    assert synced["outro"] is False
    assert synced["sala-2"] is True


async def test_a_category_with_nothing_to_see_is_left_out(client: AsyncClient) -> None:
    owner = await make_user(client, "ana")
    server = await make_server(owner)
    member = await make_user(client, "bia")
    code = (await owner.post(f"/servers/{server['id']}/invites", {})).json()["code"]
    await member.post(f"/invites/{code}/join")
    # Addons has no channel yet: it's there for who manages channels, and only for them.
    assert "Addons" in names((await owner.get(f"/servers/{server['id']}")).json())
    assert names((await member.get(f"/servers/{server['id']}")).json()) == ["Salas", "Conversas"]
