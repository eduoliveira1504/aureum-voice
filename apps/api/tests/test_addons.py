"""The addon framework (addon channels, registry, permissions, cleanup) and the example
"notes" addon that exercises it."""

from configparser import ConfigParser
from pathlib import Path
from typing import Any

from httpx import AsyncClient
from httpx_ws import aconnect_ws
from sqlalchemy import func, select

from app.addons.notes.models import NotesPage
from app.addons.registry import ADDONS
from app.db import SessionLocal
from app.permissions import Perm
from tests.helpers import ApiUser, make_server, make_user, text_channel, ws_client
from tests.test_roles import create_role, give
from tests.test_ws import next_event, no_event, ws_url


async def notes_channel(owner: ApiUser, server_id: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"name": "Anotações", "type": "addon", "addon_key": "notes"}
    if config is not None:
        body["config"] = config
    res = await owner.post(f"/servers/{server_id}/channels", body)
    assert res.status_code == 201, res.text
    return res.json()


async def page_count() -> int:
    async with SessionLocal() as session:
        return await session.scalar(select(func.count()).select_from(NotesPage)) or 0


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
    notes = addons["notes"]
    assert notes["permissions"] == {
        "view": int(Perm.VIEW_CHANNEL),
        "edit": int(Perm.SEND_MESSAGES),
        "manage": int(Perm.MANAGE_ADDONS),
    }
    assert notes["config_schema"]["properties"]["read_only"]["default"] is False


async def test_create_an_addon_channel(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    server = await make_server(owner, member)
    channel = await notes_channel(owner, server["id"])
    # Names are kept as typed, and the addon's defaults are filled in.
    assert channel["type"] == "addon" and channel["name"] == "Anotações"
    assert channel["addon_key"] == "notes" and channel["config"] == {"read_only": False}
    detail = (await member.get(f"/servers/{server['id']}")).json()
    assert channel["id"] in [c["id"] for c in detail["channels"]]
    # It's not a text channel: no messages there.
    assert (await owner.get(f"/channels/{channel['id']}/messages")).status_code == 400


async def test_addon_channel_validation(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    sid = (await make_server(owner))["id"]
    bad = [
        {"name": "x", "type": "addon"},  # no addon_key
        {"name": "x", "type": "text", "addon_key": "notes"},  # addon_key on a text channel
        {"name": "x", "type": "text", "config": {}},
        {"name": "x", "type": "addon", "addon_key": "nope"},  # unknown addon
        {"name": "x", "type": "addon", "addon_key": "notes", "config": {"read_only": "maybe"}},
    ]
    for body in bad:
        assert (await owner.post(f"/servers/{sid}/channels", body)).status_code == 422, body


async def test_creating_needs_manage_channels_and_manage_addons(client: AsyncClient) -> None:
    owner, both, channels_only = [await make_user(client, n) for n in ("owner", "both", "channels")]
    sid = (await make_server(owner, both, channels_only))["id"]
    await give(owner, sid, both, await create_role(owner, sid, "Builders", Perm.MANAGE_CHANNELS | Perm.MANAGE_ADDONS))
    await give(owner, sid, channels_only, await create_role(owner, sid, "Channels", Perm.MANAGE_CHANNELS))
    body = {"name": "notas", "type": "addon", "addon_key": "notes"}

    assert (await channels_only.post(f"/servers/{sid}/channels", body)).status_code == 403
    # MANAGE_CHANNELS alone still makes ordinary channels.
    assert (await channels_only.post(f"/servers/{sid}/channels", {"name": "chat"})).status_code == 201
    assert (await both.post(f"/servers/{sid}/channels", body)).status_code == 201


async def test_configure_needs_manage_addons(client: AsyncClient) -> None:
    owner, addon_admin, member = [await make_user(client, n) for n in ("owner", "admin", "member")]
    server = await make_server(owner, addon_admin, member)
    sid = server["id"]
    await give(owner, sid, addon_admin, await create_role(owner, sid, "Addons", Perm.MANAGE_ADDONS))
    cid = (await notes_channel(owner, sid))["id"]

    assert (await member.patch(f"/channels/{cid}", {"config": {"read_only": True}})).status_code == 403
    # Settings don't need MANAGE_CHANNELS, but renaming does.
    res = await addon_admin.patch(f"/channels/{cid}", {"config": {"read_only": True}})
    assert res.status_code == 200 and res.json()["config"] == {"read_only": True}
    assert (await addon_admin.patch(f"/channels/{cid}", {"name": "outro"})).status_code == 403
    assert (await owner.patch(f"/channels/{cid}", {"config": {"read_only": 3}})).status_code == 422
    # Ordinary channels have no settings.
    assert (await owner.patch(f"/channels/{text_channel(server)}", {"config": {}})).status_code == 400


async def test_notes_edit_and_conflicts(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    sid = (await make_server(owner, member))["id"]
    cid = (await notes_channel(owner, sid))["id"]
    url = f"/addons/notes/channels/{cid}"

    empty = (await member.get(url)).json()
    assert empty["content"] == "" and empty["version"] == 0 and empty["can_edit"] is True

    async with ws_client() as wsc, aconnect_ws(ws_url(owner), wsc) as ws:
        await next_event(ws, "ready")
        res = await member.put(url, {"content": "comprar pão", "version": 0})
        assert res.status_code == 200, res.text
        saved = res.json()
        assert saved["version"] == 1 and saved["updated_by"] == member.id
        event = await next_event(ws, "addon.notes.updated")
        assert event["channel_id"] == cid and event["server_id"] == sid
        assert event["content"] == "comprar pão" and event["version"] == 1 and "can_edit" not in event

    # An edit based on an old version is refused instead of overwriting.
    assert (await owner.put(url, {"content": "outra coisa", "version": 0})).status_code == 409
    assert (await owner.put(url, {"content": "comprar pão e café", "version": 1})).json()["version"] == 2
    assert (await member.put(url, {"content": "x" * 20_001, "version": 2})).status_code == 422


async def test_notes_permissions(client: AsyncClient) -> None:
    owner, member, outsider = [await make_user(client, n) for n in ("owner", "member", "outsider")]
    sid = (await make_server(owner, member))["id"]
    cid = (await notes_channel(owner, sid))["id"]
    url = f"/addons/notes/channels/{cid}"

    # Outside the server, or in a channel of another kind, the page doesn't exist.
    assert (await outsider.get(url)).status_code == 404
    text_cid = text_channel((await owner.get(f"/servers/{sid}")).json())
    assert (await owner.get(f"/addons/notes/channels/{text_cid}")).status_code == 404

    # Editing follows SEND_MESSAGES in the channel...
    await owner.put(f"/channels/{cid}/overrides/member/{member.id}", {"deny": int(Perm.SEND_MESSAGES)})
    assert (await member.get(url)).json()["can_edit"] is False
    assert (await member.put(url, {"content": "oi", "version": 0})).status_code == 403
    await owner.delete(f"/channels/{cid}/overrides/member/{member.id}")
    assert (await member.put(url, {"content": "oi", "version": 0})).status_code == 200

    # ...read-only pages are left to whoever manages addons...
    await owner.patch(f"/channels/{cid}", {"config": {"read_only": True}})
    assert (await member.put(url, {"content": "tchau", "version": 1})).status_code == 403
    assert (await owner.put(url, {"content": "tchau", "version": 1})).status_code == 200

    # ...and a hidden channel is a 404, like any other.
    await owner.put(f"/channels/{cid}/overrides/member/{member.id}", {"deny": int(Perm.VIEW_CHANNEL)})
    assert (await member.get(url)).status_code == 404
    async with ws_client() as wsc, aconnect_ws(ws_url(member), wsc) as ws:
        await next_event(ws, "ready")
        await owner.put(url, {"content": "segredo", "version": 2})
        await no_event(ws, "addon.notes.updated")


async def test_deleting_cleans_up_addon_data(client: AsyncClient) -> None:
    owner, mod = await make_user(client, "owner"), await make_user(client, "mod")
    sid = (await make_server(owner, mod))["id"]
    await give(owner, sid, mod, await create_role(owner, sid, "Mods", Perm.MANAGE_CHANNELS))
    first, second = (await notes_channel(owner, sid))["id"], (await notes_channel(owner, sid))["id"]
    for cid in (first, second):
        await owner.put(f"/addons/notes/channels/{cid}", {"content": "algo", "version": 0})
    assert await page_count() == 2

    # Deleting an addon channel throws away its data, so it also needs MANAGE_ADDONS.
    assert (await mod.delete(f"/channels/{first}")).status_code == 403
    assert (await owner.delete(f"/channels/{first}")).status_code == 204
    assert await page_count() == 1

    # Deleting the server cleans up the rest.
    assert (await owner.delete(f"/servers/{sid}")).status_code == 204
    assert await page_count() == 0
