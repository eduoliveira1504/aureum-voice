"""The addon framework: addon channels, the registry, permissions, cleanup and system lines.
The Kanban board is the addon that exercises it; its own behavior is in test_kanban."""

from configparser import ConfigParser
from pathlib import Path
from typing import Any

from httpx import AsyncClient
from httpx_ws import aconnect_ws
from sqlalchemy import func, select

from app.addons.kanban.models import KanbanCard, KanbanColumn
from app.addons.registry import ADDONS
from app.db import SessionLocal
from app.permissions import Perm
from tests.helpers import ApiUser, make_server, make_user, text_channel, ws_client
from tests.test_roles import create_role, give
from tests.test_ws import next_event, no_event, ws_url


async def board_channel(owner: ApiUser, server_id: str, name: str = "Quadro") -> dict[str, Any]:
    res = await owner.post(f"/servers/{server_id}/channels", {"name": name, "type": "addon", "addon_key": "kanban"})
    assert res.status_code == 201, res.text
    return res.json()


async def add_card(user: ApiUser, cid: str, title: str = "Card", column: int = 0) -> dict[str, Any]:
    board = (await user.get(f"/addons/kanban/channels/{cid}")).json()
    res = await user.post(f"/addons/kanban/channels/{cid}/cards", {"column_id": board["columns"][column]["id"], "title": title})
    assert res.status_code == 201, res.text
    return res.json()


async def rows(model: Any) -> int:
    async with SessionLocal() as session:
        return await session.scalar(select(func.count()).select_from(model)) or 0


def test_every_addon_migration_folder_is_in_alembic_ini() -> None:
    api_dir = Path(__file__).resolve().parents[1]
    ini = ConfigParser(interpolation=None)
    ini.read(api_dir / "alembic.ini")
    locations = ini["alembic"]["version_locations"].replace("%(here)s/", "").split()
    for key in ADDONS:
        if (api_dir / "app" / "addons" / key / "migrations").is_dir():
            assert f"app/addons/{key}/migrations" in locations, key


async def test_registry_lists_the_addons(client: AsyncClient) -> None:
    user = await make_user(client, "user")
    addons = {a["key"]: a for a in (await user.get("/addons")).json()}
    assert set(addons) == {"kanban", "whiteboard", "events", "calendar"}
    kanban = addons["kanban"]
    assert kanban["permissions"] == {
        "view": int(Perm.VIEW_CHANNEL),
        "edit": int(Perm.SEND_MESSAGES),
        "manage": int(Perm.MANAGE_ADDONS),
    }
    assert kanban["config_schema"] is None and kanban["announces"] is True
    assert addons["whiteboard"]["permissions"] == {"view": int(Perm.VIEW_CHANNEL), "edit": int(Perm.EDIT_WHITEBOARD)}
    assert addons["events"]["permissions"] == {"view": int(Perm.VIEW_CHANNEL), "manage": int(Perm.MANAGE_EVENTS | Perm.MANAGE_ADDONS)}


async def test_create_an_addon_channel(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    server = await make_server(owner, member)
    channel = await board_channel(owner, server["id"], "Tarefas da Semana")
    # Names are kept as typed; no announce channel until someone picks one.
    assert channel["type"] == "addon" and channel["name"] == "Tarefas da Semana"
    assert channel["addon_key"] == "kanban" and channel["config"] == {} and channel["announce_channel_id"] is None
    detail = (await member.get(f"/servers/{server['id']}")).json()
    assert channel["id"] in [c["id"] for c in detail["channels"]]
    # It's not a text channel: no messages there.
    assert (await owner.get(f"/channels/{channel['id']}/messages")).status_code == 400


async def test_addon_channel_validation(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    sid = (await make_server(owner))["id"]
    bad = [
        {"name": "x", "type": "addon"},  # no addon_key
        {"name": "x", "type": "text", "addon_key": "kanban"},  # addon_key on a text channel
        {"name": "x", "type": "text", "config": {}},
        {"name": "x", "type": "addon", "addon_key": "nope"},  # unknown addon
        {"name": "x", "type": "addon", "addon_key": "notes"},  # the removed example addon
        {"name": "x", "type": "addon", "addon_key": "kanban", "config": {"x": 1}},  # takes no settings
    ]
    for body in bad:
        assert (await owner.post(f"/servers/{sid}/channels", body)).status_code == 422, body


async def test_creating_needs_manage_channels_and_manage_addons(client: AsyncClient) -> None:
    owner, both, channels_only = [await make_user(client, n) for n in ("owner", "both", "channels")]
    sid = (await make_server(owner, both, channels_only))["id"]
    await give(owner, sid, both, await create_role(owner, sid, "Builders", Perm.MANAGE_CHANNELS | Perm.MANAGE_ADDONS))
    await give(owner, sid, channels_only, await create_role(owner, sid, "Channels", Perm.MANAGE_CHANNELS))
    body = {"name": "quadro", "type": "addon", "addon_key": "kanban"}

    assert (await channels_only.post(f"/servers/{sid}/channels", body)).status_code == 403
    # MANAGE_CHANNELS alone still makes ordinary channels.
    assert (await channels_only.post(f"/servers/{sid}/channels", {"name": "chat"})).status_code == 201
    assert (await both.post(f"/servers/{sid}/channels", body)).status_code == 201


async def test_configure_needs_manage_addons(client: AsyncClient) -> None:
    owner, addon_admin, member = [await make_user(client, n) for n in ("owner", "admin", "member")]
    server = await make_server(owner, addon_admin, member)
    sid, chat = server["id"], text_channel(server)
    await give(owner, sid, addon_admin, await create_role(owner, sid, "Addons", Perm.MANAGE_ADDONS))
    cid = (await board_channel(owner, sid))["id"]

    assert (await member.patch(f"/channels/{cid}", {"announce_channel_id": chat})).status_code == 403
    # Settings don't need MANAGE_CHANNELS, but renaming does.
    res = await addon_admin.patch(f"/channels/{cid}", {"announce_channel_id": chat})
    assert res.status_code == 200 and res.json()["announce_channel_id"] == chat
    assert (await addon_admin.patch(f"/channels/{cid}", {"name": "outro"})).status_code == 403
    res = await addon_admin.patch(f"/channels/{cid}", {"announce_channel_id": None})
    assert res.status_code == 200 and res.json()["announce_channel_id"] is None
    assert (await owner.patch(f"/channels/{cid}", {"config": {"x": 1}})).status_code == 422
    # Ordinary channels have no settings.
    assert (await owner.patch(f"/channels/{chat}", {"config": {}})).status_code == 400
    assert (await owner.patch(f"/channels/{chat}", {"announce_channel_id": chat})).status_code == 400


async def test_announce_channel_must_be_a_text_channel_of_the_server(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    server, other = await make_server(owner), await make_server(owner, name="Outro")
    sid = server["id"]
    cid = (await board_channel(owner, sid))["id"]
    voice = next(c["id"] for c in server["channels"] if c["type"] == "voice")
    for target in (voice, cid, text_channel(other)):
        assert (await owner.patch(f"/channels/{cid}", {"announce_channel_id": target})).status_code == 422
    missing = "00000000-0000-0000-0000-000000000000"
    assert (await owner.patch(f"/channels/{cid}", {"announce_channel_id": missing})).status_code == 404


async def test_wider_announce_channel_needs_confirmation(client: AsyncClient) -> None:
    owner, crew, outsider = [await make_user(client, n) for n in ("owner", "crew", "outsider")]
    server = await make_server(owner, crew, outsider)
    sid, chat = server["id"], text_channel(server)
    crew_role = await create_role(owner, sid, "Crew")
    await give(owner, sid, crew, crew_role)
    cid = (await board_channel(owner, sid))["id"]
    # A private board: only Crew sees it.
    await owner.put(f"/channels/{cid}/overrides/role/{sid}", {"deny": int(Perm.VIEW_CHANNEL)})
    await owner.put(f"/channels/{cid}/overrides/role/{crew_role['id']}", {"allow": int(Perm.VIEW_CHANNEL)})

    # #geral is seen by the outsider too: the API asks for a confirmation first.
    res = await owner.patch(f"/channels/{cid}", {"announce_channel_id": chat})
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "wider_audience" and res.json()["detail"]["count"] == 1
    board = next(c for c in (await owner.get(f"/servers/{sid}")).json()["channels"] if c["id"] == cid)
    assert board["announce_channel_id"] is None
    res = await owner.patch(f"/channels/{cid}", {"announce_channel_id": chat, "confirm_wider_audience": True})
    assert res.status_code == 200 and res.json()["announce_channel_id"] == chat
    # Saving it again (unchanged) doesn't ask again.
    assert (await owner.patch(f"/channels/{cid}", {"announce_channel_id": chat})).status_code == 200

    # A channel seen by the same people (or fewer) needs no confirmation.
    crew_chat = (await owner.post(f"/servers/{sid}/channels", {"name": "crew"})).json()["id"]
    await owner.put(f"/channels/{crew_chat}/overrides/role/{sid}", {"deny": int(Perm.VIEW_CHANNEL)})
    await owner.put(f"/channels/{crew_chat}/overrides/role/{crew_role['id']}", {"allow": int(Perm.VIEW_CHANNEL)})
    assert (await owner.patch(f"/channels/{cid}", {"announce_channel_id": crew_chat})).status_code == 200


async def test_moving_a_card_posts_a_system_line(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    server = await make_server(owner, member)
    sid, chat = server["id"], text_channel(server)
    cid = (await board_channel(owner, sid))["id"]
    columns = (await member.get(f"/addons/kanban/channels/{cid}")).json()["columns"]
    first, second = await add_card(member, cid, "Login"), await add_card(member, cid, "Cadastro")
    move = f"/addons/kanban/channels/{cid}/cards"

    # Off by default: moving says nothing in the chat.
    await member.post(f"{move}/{first['id']}/move", {"column_id": columns[1]["id"], "position": 0})
    assert (await owner.get(f"/channels/{chat}/messages")).json() == []

    await owner.patch(f"/channels/{cid}", {"announce_channel_id": chat})
    async with ws_client() as wsc, aconnect_ws(ws_url(owner), wsc) as ws:
        await next_event(ws, "ready")
        await member.post(f"{move}/{first['id']}/move", {"column_id": columns[2]["id"], "position": 0})
        line = await next_event(ws, "message.created")
        assert line["author"]["id"] == member.id and line["content"] == "" and line["mentions"] == []
        assert line["system"]["addon_key"] == "kanban" and line["system"]["source_channel_id"] == cid
        assert line["system"]["lines"] == ["moveu “Login” para Feito"]

        # Reordering inside a column isn't news.
        await member.post(f"{move}/{first['id']}/move", {"column_id": columns[2]["id"], "position": 3})
        await no_event(ws, "message.created")

        # A quick run of moves by the same person goes into the same line.
        await member.post(f"{move}/{second['id']}/move", {"column_id": columns[1]["id"], "position": 0})
        merged = await next_event(ws, "message.updated")
        assert merged["id"] == line["id"]
        assert merged["system"]["lines"] == ["moveu “Login” para Feito", "moveu “Cadastro” para Fazendo"]

        # Someone else's move starts a new line.
        await owner.post(f"{move}/{second['id']}/move", {"column_id": columns[2]["id"], "position": 0})
        assert (await next_event(ws, "message.created"))["author"]["id"] == owner.id

    messages = (await owner.get(f"/channels/{chat}/messages")).json()
    assert len(messages) == 2 and messages[0]["system"]["lines"][1] == "moveu “Cadastro” para Fazendo"
    # System lines can't be edited, not even by their "author".
    assert (await member.patch(f"/messages/{messages[0]['id']}", {"content": "oi"})).status_code == 400

    # Deleting the announce channel turns the lines off.
    assert (await owner.delete(f"/channels/{chat}")).status_code == 204
    board = next(c for c in (await owner.get(f"/servers/{sid}")).json()["channels"] if c["id"] == cid)
    assert board["announce_channel_id"] is None
    assert (await member.post(f"{move}/{first['id']}/move", {"column_id": columns[0]["id"], "position": 0})).status_code == 200


async def test_system_lines_reach_only_who_sees_the_chat(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    server = await make_server(owner, member)
    sid, chat = server["id"], text_channel(server)
    cid = (await board_channel(owner, sid))["id"]
    await owner.patch(f"/channels/{cid}", {"announce_channel_id": chat})
    await owner.put(f"/channels/{chat}/overrides/member/{member.id}", {"deny": int(Perm.VIEW_CHANNEL)})
    card = await add_card(owner, cid)
    done = (await owner.get(f"/addons/kanban/channels/{cid}")).json()["columns"][2]["id"]
    async with ws_client() as wsc, aconnect_ws(ws_url(member), wsc) as ws:
        await next_event(ws, "ready")
        await owner.post(f"/addons/kanban/channels/{cid}/cards/{card['id']}/move", {"column_id": done, "position": 0})
        await next_event(ws, "addon.kanban.cards.moved")
        await no_event(ws, "message.created")


async def test_deleting_cleans_up_addon_data(client: AsyncClient) -> None:
    owner, mod = await make_user(client, "owner"), await make_user(client, "mod")
    sid = (await make_server(owner, mod))["id"]
    await give(owner, sid, mod, await create_role(owner, sid, "Mods", Perm.MANAGE_CHANNELS))
    first, second = (await board_channel(owner, sid))["id"], (await board_channel(owner, sid))["id"]
    for cid in (first, second):
        await add_card(owner, cid)
    assert await rows(KanbanCard) == 2 and await rows(KanbanColumn) == 6

    # Deleting an addon channel throws away its data, so it also needs MANAGE_ADDONS.
    assert (await mod.delete(f"/channels/{first}")).status_code == 403
    assert (await owner.delete(f"/channels/{first}")).status_code == 204
    assert await rows(KanbanCard) == 1 and await rows(KanbanColumn) == 3

    # Deleting the server cleans up the rest.
    assert (await owner.delete(f"/servers/{sid}")).status_code == 204
    assert await rows(KanbanCard) == 0 and await rows(KanbanColumn) == 0
