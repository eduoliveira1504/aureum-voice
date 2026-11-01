"""Channel categories (block 3.12)."""

import importlib.util
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.db import engine
from app.permissions import Perm
from app.realtime import broker
from tests.helpers import ApiUser, make_server, make_user, text_channel

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


async def setup(client: AsyncClient) -> tuple[ApiUser, ApiUser, dict[str, Any]]:
    owner = await make_user(client, "ana")
    member = await make_user(client, "bia")
    return owner, member, await make_server(owner, member)


async def detail(user: ApiUser, server: dict[str, Any]) -> dict[str, Any]:
    return (await user.get(f"/servers/{server['id']}")).json()


async def add_category(owner: ApiUser, server: dict[str, Any], name: str = "Administração") -> dict[str, Any]:
    res = await owner.post(f"/servers/{server['id']}/categories", {"name": name})
    assert res.status_code == 201, res.text
    return res.json()


async def add_channel(owner: ApiUser, server: dict[str, Any], category: dict[str, Any], name: str = "mods", **extra: Any) -> dict[str, Any]:
    res = await owner.post(f"/servers/{server['id']}/channels", {"name": name, "category_id": category["id"], **extra})
    assert res.status_code == 201, res.text
    return res.json()


async def hide(owner: ApiUser, server: dict[str, Any], category: dict[str, Any]) -> None:
    res = await owner.put(f"/categories/{category['id']}/overrides/role/{server['id']}", {"deny": int(Perm.VIEW_CHANNEL)})
    assert res.status_code == 200, res.text


async def test_create_rename_and_order(client: AsyncClient) -> None:
    owner, member, server = await setup(client)
    assert (await member.post(f"/servers/{server['id']}/categories", {"name": "Nope"})).status_code == 403
    category = await add_category(owner, server, "Jogos")
    assert (await owner.patch(f"/categories/{category['id']}", {"name": "Games"})).json()["name"] == "Games"
    ids = [c["id"] for c in sorted((await detail(owner, server))["categories"], key=lambda c: c["position"])]
    res = await owner.put(f"/servers/{server['id']}/categories/order", {"category_ids": list(reversed(ids))})
    assert res.status_code == 200, res.text
    assert names(await detail(owner, server)) == ["Games", "Addons", "Conversas", "Salas"]
    assert (await owner.put(f"/servers/{server['id']}/categories/order", {"category_ids": ids[:2]})).status_code == 422


async def test_a_private_category_is_gone_for_who_has_no_access(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    owner, member, server = await setup(client)
    category = await add_category(owner, server)
    channel = await add_channel(owner, server, category)
    published: list[tuple[str, Any]] = []
    original = broker.publish

    async def spy(event: str, data: Any, *args: Any, **kwargs: Any) -> None:
        published.append((event, data))
        await original(event, data, *args, **kwargs)

    monkeypatch.setattr(broker, "publish", spy)
    await hide(owner, server, category)
    await owner.patch(f"/categories/{category['id']}", {"name": "Segredo"})

    seen = await detail(member, server)
    assert "Segredo" not in names(seen)
    assert channel["id"] not in [c["id"] for c in seen["channels"]]
    assert (await member.get(f"/channels/{channel['id']}/messages")).status_code in (403, 404)
    assert (await member.patch(f"/categories/{category['id']}", {"name": "x"})).status_code == 404
    assert "Segredo" in names(await detail(owner, server))
    # On the WebSocket only "refetch": the name and the channels never go out.
    assert published
    assert all("Segredo" not in str(data) for _, data in published)


async def test_a_new_channel_follows_its_category_unless_private(client: AsyncClient) -> None:
    owner, _, server = await setup(client)
    category = await add_category(owner, server)
    await hide(owner, server, category)
    synced = await add_channel(owner, server, category)
    assert synced["permissions_synced"] is True
    assert [o["target_id"] for o in synced["overrides"]] == [server["id"]]
    private = await add_channel(owner, server, category, name="meu", private=True)
    assert private["permissions_synced"] is False


async def test_editing_the_category_reaches_only_synced_channels(client: AsyncClient) -> None:
    owner, member, server = await setup(client)
    category = await add_category(owner, server)
    follows = await add_channel(owner, server, category, name="segue")
    own = await add_channel(owner, server, category, name="proprio")
    role = (await owner.post(f"/servers/{server['id']}/roles", {"name": "Mod"})).json()
    res = await owner.put(f"/channels/{own['id']}/overrides/role/{role['id']}", {"allow": int(Perm.SEND_MESSAGES)})
    assert res.json()["permissions_synced"] is False

    await hide(owner, server, category)
    shown = [c["id"] for c in (await detail(member, server))["channels"]]
    assert follows["id"] not in shown
    assert own["id"] in shown

    # Back to the category: its own permissions go.
    res = await owner.post(f"/channels/{own['id']}/permissions/sync")
    assert res.status_code == 200, res.text
    assert res.json()["permissions_synced"] is True
    assert own["id"] not in [c["id"] for c in (await detail(member, server))["channels"]]


async def test_moving_a_channel_never_opens_it(client: AsyncClient) -> None:
    owner, member, server = await setup(client)
    secret = await add_category(owner, server, "Segredo")
    await hide(owner, server, secret)
    channel = await add_channel(owner, server, secret)
    open_category = next(c for c in server["categories"] if c["name"] == "Conversas")
    here = [c["id"] for c in server["channels"] if c["category_id"] == open_category["id"]]
    res = await owner.put(f"/servers/{server['id']}/channels/arrange", {"category_id": open_category["id"], "channel_ids": [channel["id"], *here]})
    assert res.status_code == 200, res.text
    assert res.json()[0]["category_id"] == open_category["id"]
    assert res.json()[0]["permissions_synced"] is False
    assert channel["id"] not in [c["id"] for c in (await detail(member, server))["channels"]]
    ordered = [c["id"] for c in (await detail(owner, server))["channels"] if c["category_id"] == open_category["id"]]
    assert ordered == [channel["id"], *here]


async def test_moving_needs_the_whole_list_and_the_permission(client: AsyncClient) -> None:
    owner, member, server = await setup(client)
    conversas = next(c for c in server["categories"] if c["name"] == "Conversas")
    salas = next(c for c in server["categories"] if c["name"] == "Salas")
    text_id = text_channel(server)
    path = f"/servers/{server['id']}/channels/arrange"
    assert (await member.put(path, {"category_id": salas["id"], "channel_ids": [text_id]})).status_code == 403
    assert (await owner.put(path, {"category_id": conversas["id"], "channel_ids": []})).status_code == 422
    # Mixed types are the point of a category.
    voice = next(c["id"] for c in server["channels"] if c["type"] == "voice")
    assert (await owner.put(path, {"category_id": salas["id"], "channel_ids": [text_id, voice]})).status_code == 200


async def test_deleting_a_category_keeps_its_channels(client: AsyncClient) -> None:
    owner, member, server = await setup(client)
    category = await add_category(owner, server)
    channel = await add_channel(owner, server, category)
    await hide(owner, server, category)
    assert (await member.delete(f"/categories/{category['id']}")).status_code == 404
    assert (await owner.delete(f"/categories/{category['id']}")).status_code == 204
    after = await detail(owner, server)
    kept = next(c for c in after["channels"] if c["id"] == channel["id"])
    assert kept["category_id"] is None
    assert "Administração" not in names(after)
    # Still as private as it was.
    assert channel["id"] not in [c["id"] for c in (await detail(member, server))["channels"]]


async def test_category_overrides_follow_the_channel_rules(client: AsyncClient) -> None:
    owner, member, server = await setup(client)
    category = await add_category(owner, server)
    everyone = f"/categories/{category['id']}/overrides/role/{server['id']}"
    assert (await member.put(everyone, {"deny": int(Perm.VIEW_CHANNEL)})).status_code in (403, 404)
    assert (await owner.put(everyone, {"allow": 1, "deny": 1})).status_code == 422
    await hide(owner, server, category)
    res = await owner.delete(everyone)
    assert res.status_code == 200
    assert res.json()["overrides"] == []
