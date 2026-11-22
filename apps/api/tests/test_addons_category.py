"""The addons category (block 4.2.8): addons live there and only they do."""

import importlib.util
from pathlib import Path
from typing import Any

from httpx import AsyncClient
from sqlalchemy import text

from app import categories
from app.db import engine
from app.permissions import Perm
from tests.helpers import ApiUser, make_server, make_user, text_channel

MIGRATION = Path(__file__).parent.parent / "alembic" / "versions" / "20261122_e2a8c4f6b719_addons_category.py"


def by_name(server: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {c["name"]: c for c in server["categories"]}


def addons_of(server: dict[str, Any]) -> dict[str, Any]:
    [category] = [c for c in server["categories"] if c["kind"] == "addons"]
    return category


async def add_addon(owner: ApiUser, server_id: str, category_id: str | None = None, name: str = "Tarefas") -> dict[str, Any]:
    body = {"name": name, "type": "addon", "addon_key": "kanban"} | ({"category_id": category_id} if category_id else {})
    res = await owner.post(f"/servers/{server_id}/channels", body)
    assert res.status_code == 201, res.text
    return res.json()


async def test_a_new_server_has_one_addons_category(client: AsyncClient) -> None:
    owner = await make_user(client, "ana")
    server = await make_server(owner)
    assert {c["name"]: c["kind"] for c in server["categories"]} == {"Salas": "normal", "Conversas": "normal", "Addons": "addons"}


async def test_an_addon_always_lands_in_the_addons_category(client: AsyncClient) -> None:
    """Older apps send no category, or the one picked in their selector: no error either way."""
    owner = await make_user(client, "ana")
    server = await make_server(owner)
    addons = addons_of(server)
    assert (await add_addon(owner, server["id"]))["category_id"] == addons["id"]
    assert (await add_addon(owner, server["id"], by_name(server)["Salas"]["id"], "Outro"))["category_id"] == addons["id"]
    assert (await add_addon(owner, server["id"], addons["id"], "Mais um"))["category_id"] == addons["id"]


async def test_a_channel_cant_be_created_in_the_addons_category(client: AsyncClient) -> None:
    owner = await make_user(client, "ana")
    server = await make_server(owner)
    for type_ in ("text", "voice"):
        res = await owner.post(f"/servers/{server['id']}/channels", {"name": "x", "type": type_, "category_id": addons_of(server)["id"]})
        assert res.status_code == 409 and res.json()["detail"] == categories.ONLY_ADDONS
    res = await owner.post(f"/servers/{server['id']}/channels", {"name": "x", "type": "text", "category_id": by_name(server)["Salas"]["id"]})
    assert res.status_code == 201


async def test_the_addons_category_cant_be_renamed_or_deleted(client: AsyncClient) -> None:
    owner = await make_user(client, "ana")
    server = await make_server(owner)
    addons = addons_of(server)
    res = await owner.patch(f"/categories/{addons['id']}", {"name": "Ferramentas"})
    assert res.status_code == 409 and res.json()["detail"] == categories.LOCKED_RENAME
    res = await owner.delete(f"/categories/{addons['id']}")
    assert res.status_code == 409 and res.json()["detail"] == categories.LOCKED_DELETE
    # Its permissions and its place stay editable.
    res = await owner.put(f"/categories/{addons['id']}/overrides/role/{server['id']}", {"allow": 0, "deny": int(Perm.VIEW_CHANNEL)})
    assert res.status_code == 200, res.text
    order = [addons["id"], *(c["id"] for c in server["categories"] if c["kind"] == "normal")]
    assert (await owner.put(f"/servers/{server['id']}/categories/order", {"category_ids": order})).status_code == 200


async def test_the_name_addons_is_reserved(client: AsyncClient) -> None:
    owner = await make_user(client, "ana")
    server = await make_server(owner)
    for name in ("Addons", "aDDons", "  ADDONS "):
        res = await owner.post(f"/servers/{server['id']}/categories", {"name": name})
        assert res.status_code == 409 and res.json()["detail"] == categories.RESERVED_NAME
        res = await owner.patch(f"/categories/{by_name(server)['Salas']['id']}", {"name": name})
        assert res.status_code == 409 and res.json()["detail"] == categories.RESERVED_NAME
    assert (await owner.post(f"/servers/{server['id']}/categories", {"name": "Addons do time"})).status_code == 201


async def test_moving_respects_the_kinds(client: AsyncClient) -> None:
    owner = await make_user(client, "ana")
    server = await make_server(owner)
    sid, path = server["id"], f"/servers/{server['id']}/channels/arrange"
    addon = await add_addon(owner, sid)
    other = await add_addon(owner, sid, name="Outro")
    chat = text_channel(server)
    cats = by_name(server)
    conversas = [chat]
    salas = [c["id"] for c in server["channels"] if c["type"] == "voice"]

    res = await owner.put(path, {"category_id": addons_of(server)["id"], "channel_ids": [addon["id"], other["id"], chat]})
    assert res.status_code == 409 and res.json()["detail"] == categories.ONLY_ADDONS
    for target, here in ((cats["Conversas"]["id"], conversas), (cats["Salas"]["id"], salas)):
        res = await owner.put(path, {"category_id": target, "channel_ids": [*here, addon["id"]]})
        assert res.status_code == 409 and res.json()["detail"] == categories.ADDONS_STAY
    res = await owner.put(path, {"category_id": None, "channel_ids": [addon["id"]]})
    assert res.status_code == 409 and res.json()["detail"] == categories.ADDONS_STAY

    # Inside its own category, an addon still moves freely.
    res = await owner.put(path, {"category_id": addons_of(server)["id"], "channel_ids": [other["id"], addon["id"]]})
    assert res.status_code == 200, res.text
    after = (await owner.get(f"/servers/{sid}")).json()
    assert all(c["category_id"] == addons_of(server)["id"] for c in after["channels"] if c["type"] == "addon")
    assert next(c for c in after["channels"] if c["id"] == chat)["category_id"] == cats["Conversas"]["id"]


async def test_migration_fixes_every_server(client: AsyncClient) -> None:
    owner = await make_user(client, "ana")
    renamed = await make_server(owner, name="Renomeada")
    deleted = await make_server(owner, name="Excluida")
    mixed_up = await make_server(owner, name="Misturada")
    addon_renamed = await add_addon(owner, renamed["id"])
    addon_deleted = await add_addon(owner, deleted["id"])
    addon_out = await add_addon(owner, mixed_up["id"])
    private = await owner.post(f"/servers/{mixed_up['id']}/channels", {"name": "segredo", "type": "text", "private": True})
    assert private.status_code == 201
    private_id = private.json()["id"]
    chat, salas = text_channel(mixed_up), by_name(mixed_up)["Salas"]["id"]
    room = next(c["id"] for c in mixed_up["channels"] if c["type"] == "voice")

    # As servers could look before the migration.
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE channel_categories SET kind = 'normal'"))
        await conn.execute(
            text("UPDATE channel_categories SET name = 'Ferramentas' WHERE server_id = :s AND name = 'Addons'"), {"s": renamed["id"]}
        )
        await conn.execute(text("UPDATE channels SET category_id = NULL WHERE server_id = :s"), {"s": deleted["id"]})
        await conn.execute(text("DELETE FROM channel_categories WHERE server_id = :s AND name = 'Addons'"), {"s": deleted["id"]})
        mixed_addons = addons_of(mixed_up)["id"]
        await conn.execute(text("UPDATE channels SET category_id = :c WHERE id IN (:a, :b, :p)"), {"c": mixed_addons, "a": chat, "b": room, "p": private_id})
        await conn.execute(text("UPDATE channels SET category_id = :c WHERE id = :a"), {"c": salas, "a": addon_out["id"]})

    spec = importlib.util.spec_from_file_location("migration", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for _ in range(2):  # safe to run twice
        async with engine.begin() as conn:
            for statement in module.BACKFILL:
                await conn.execute(text(statement))

    after = (await owner.get(f"/servers/{renamed['id']}")).json()
    kinds = {c["name"]: c["kind"] for c in after["categories"]}
    assert kinds == {"Salas": "normal", "Conversas": "normal", "Ferramentas": "normal", "Addons": "addons"}
    assert max(after["categories"], key=lambda c: c["position"])["name"] == "Addons"
    assert next(c for c in after["channels"] if c["id"] == addon_renamed["id"])["category_id"] == addons_of(after)["id"]

    after = (await owner.get(f"/servers/{deleted['id']}")).json()
    assert [c["name"] for c in after["categories"] if c["kind"] == "addons"] == ["Addons"]
    assert next(c for c in after["channels"] if c["id"] == addon_deleted["id"])["category_id"] == addons_of(after)["id"]

    after = (await owner.get(f"/servers/{mixed_up['id']}")).json()
    cats, channels = by_name(after), {c["id"]: c for c in after["channels"]}
    assert addons_of(after)["id"] == mixed_addons
    assert channels[chat]["category_id"] == cats["Conversas"]["id"] and channels[chat]["permissions_synced"] is True
    assert channels[room]["category_id"] == cats["Salas"]["id"]
    assert channels[addon_out["id"]]["category_id"] == mixed_addons
    # Moving never changes permissions: the private one stays private, out of sync.
    assert channels[private_id]["category_id"] == cats["Conversas"]["id"]
    assert channels[private_id]["permissions_synced"] is False and channels[private_id]["overrides"]
