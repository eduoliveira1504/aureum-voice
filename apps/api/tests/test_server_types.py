"""Block 4.2.1: server types and the addons each one allows."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.addons.registry import ADDONS
from app.db import engine
from app.models import ServerType
from app.server_types import FEATURES, SERVER_TYPES
from tests.helpers import make_server, make_user
from tests.test_soundboard import add as add_sound


def test_every_key_is_a_real_addon_or_feature() -> None:
    known = set(ADDONS) | FEATURES
    for info in SERVER_TYPES.values():
        assert info.keys <= known, f"{info.type}: unknown keys {info.keys - known}"
    assert set(SERVER_TYPES) == set(ServerType)


def test_mixed_allows_everything_the_others_do() -> None:
    mixed = SERVER_TYPES[ServerType.mixed].keys
    assert SERVER_TYPES[ServerType.game].keys | SERVER_TYPES[ServerType.work].keys == mixed


async def test_servers_saved_without_a_type_are_mixed(client: AsyncClient) -> None:
    # What the migration does to servers that existed before it: the column's default.
    owner = await make_user(client, "owner")
    server_id = uuid.uuid4()
    async with engine.begin() as conn:
        await conn.execute(
            text("INSERT INTO servers (id, name, owner_id) VALUES (:id, 'Antigo', :owner)"),
            {"id": server_id, "owner": uuid.UUID(owner.id)},
        )
        assert (await conn.execute(text("SELECT type FROM servers WHERE id = :id"), {"id": server_id})).scalar() == "mixed"


@pytest.mark.parametrize("type_", ["game", "work", "mixed"])
async def test_create_each_type(client: AsyncClient, type_: str) -> None:
    owner = await make_user(client, "owner")
    server = await make_server(owner, type=type_)
    assert server["type"] == type_
    assert server["addons"] == sorted(SERVER_TYPES[ServerType(type_)].keys)
    listed = (await owner.get("/servers")).json()
    assert [(s["type"], s["addons"]) for s in listed] == [(type_, server["addons"])]


async def test_older_apps_without_a_type_get_mixed(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    server = await make_server(owner)
    assert server["type"] == "mixed"


async def test_unknown_type_is_refused(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    assert (await owner.post("/servers", {"name": "X", "type": "music"})).status_code == 422


async def test_type_cannot_be_changed(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    server = await make_server(owner, type="game")
    for body in ({"type": "work"}, {"type": "game"}, {"name": "Novo", "type": "mixed"}, {"type": None}):
        res = await owner.patch(f"/servers/{server['id']}", body)
        assert res.status_code == 422, body
    assert (await owner.get(f"/servers/{server['id']}")).json()["type"] == "game"
    # Renaming still works.
    assert (await owner.patch(f"/servers/{server['id']}", {"name": "Novo"})).json()["name"] == "Novo"


@pytest.mark.parametrize(("type_", "key", "ok"), [
    ("game", "kanban", False),
    ("game", "whiteboard", False),
    ("game", "calendar", True),
    ("game", "events", True),
    ("work", "kanban", True),
    ("work", "whiteboard", True),
    ("mixed", "kanban", True),
])
async def test_addon_outside_the_type_is_refused(client: AsyncClient, type_: str, key: str, ok: bool) -> None:
    owner = await make_user(client, "owner")
    server = await make_server(owner, type=type_)
    res = await owner.post(f"/servers/{server['id']}/channels", {"name": "x", "type": "addon", "addon_key": key})
    assert res.status_code == (201 if ok else 403), res.text


async def test_work_servers_have_no_soundboard(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    work = await make_server(owner, type="work")
    assert (await add_sound(owner, work["id"])).status_code == 403
    assert (await owner.get(f"/servers/{work['id']}/sounds")).json() == []

    game = await make_server(owner, type="game")
    assert (await add_sound(owner, game["id"])).status_code == 201


async def test_sounds_cannot_play_where_the_type_has_no_soundboard(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    server = await make_server(owner)
    sound = (await add_sound(owner, server["id"])).json()
    # Can't happen through the API (the type is locked); guards the route anyway.
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE servers SET type = 'work' WHERE id = :id"), {"id": uuid.UUID(server["id"])})
    assert (await owner.post(f"/sounds/{sound['id']}/play")).status_code == 403


async def test_server_types_endpoint(client: AsyncClient) -> None:
    user = await make_user(client, "user")
    types = (await user.get("/server-types")).json()
    assert [t["type"] for t in types] == ["game", "work", "mixed"]
    work = next(t for t in types if t["type"] == "work")
    assert work["name"] == "Trabalho" and "soundboard" not in work["addons"] and "kanban" in work["addons"]
