"""Private channels: created hidden from @everyone and open to picked roles and members. Someone
without access can't list, read, write, join or hear about them, through any route or event."""

from typing import Any

from httpx import AsyncClient
from httpx_ws import aconnect_ws

from app.permissions import Perm
from tests.helpers import ApiUser, make_server, make_user, ws_client
from tests.test_roles import create_role, give
from tests.test_ws import next_event, no_event, ws_url

VIEW, CONNECT = int(Perm.VIEW_CHANNEL), int(Perm.CONNECT)


async def create_private(owner: ApiUser, sid: str, type_: str = "text", **body: Any) -> dict[str, Any]:
    res = await owner.post(f"/servers/{sid}/channels", {"name": "staff", "type": type_, "private": True, **body})
    assert res.status_code == 201, res.text
    return res.json()


def seen_by(detail: dict[str, Any]) -> list[str]:
    return [c["id"] for c in detail["channels"]]


async def test_private_text_channel(client: AsyncClient) -> None:
    owner, mod, guest, member = [await make_user(client, n) for n in ("owner", "mod", "guest", "member")]
    server = await make_server(owner, mod, guest, member)
    sid = server["id"]
    mods = await create_role(owner, sid, "Mods")
    await give(owner, sid, mod, mods)

    async with ws_client() as wsc, aconnect_ws(ws_url(member), wsc) as hidden, aconnect_ws(ws_url(guest), wsc) as allowed:
        await next_event(hidden, "ready")
        await next_event(allowed, "ready")
        channel = await create_private(owner, sid, allowed_roles=[mods["id"]], allowed_members=[guest.id])
        cid = channel["id"]
        assert {(o["target_type"], o["target_id"], o["allow"], o["deny"]) for o in channel["overrides"]} == {
            ("role", sid, 0, VIEW),
            ("role", mods["id"], VIEW, 0),
            ("member", guest.id, VIEW, 0),
        }
        # Only who can see it hears it was created, and later its messages.
        assert (await next_event(allowed, "channel.created"))["id"] == cid
        await no_event(hidden, "channel.created")
        assert (await mod.post(f"/channels/{cid}/messages", {"content": "secret @member"})).status_code == 201
        await next_event(allowed, "message.created")
        await no_event(hidden, "message.created")

    for user in (owner, mod, guest):
        assert cid in seen_by((await user.get(f"/servers/{sid}")).json())
        assert [m["content"] for m in (await user.get(f"/channels/{cid}/messages")).json()] == ["secret @member"]
    # For the member it doesn't exist: not listed, not readable, not writable, not editable.
    assert cid not in seen_by((await member.get(f"/servers/{sid}")).json())
    assert (await member.get(f"/channels/{cid}/messages")).status_code == 404
    assert (await member.post(f"/channels/{cid}/messages", {"content": "hi"})).status_code == 404
    assert (await member.post(f"/channels/{cid}/read")).status_code == 404
    assert (await member.patch(f"/channels/{cid}", {"name": "x"})).status_code == 404
    # Nor in the overview's feed or their unread counts (the @mention didn't count).
    assert all(m["channel_id"] != cid for m in (await member.get(f"/servers/{sid}/unread")).json())
    assert all(r["channel_id"] != cid for r in (await member.get(f"/servers/{sid}")).json()["reads"])


async def test_private_voice_channel(client: AsyncClient) -> None:
    owner, guest, member = [await make_user(client, n) for n in ("owner", "guest", "member")]
    sid = (await make_server(owner, guest, member))["id"]
    channel = await create_private(owner, sid, "voice", allowed_members=[guest.id])
    vid = channel["id"]
    # In a room, joining is closed too.
    assert {(o["target_id"], o["allow"], o["deny"]) for o in channel["overrides"]} == {
        (sid, 0, VIEW | CONNECT),
        (guest.id, VIEW | CONNECT, 0),
    }
    assert (await guest.post(f"/channels/{vid}/voice/token")).status_code == 200
    assert (await member.post(f"/channels/{vid}/voice/token")).status_code == 404

    async with ws_client() as wsc, aconnect_ws(ws_url(member), wsc) as mws, aconnect_ws(ws_url(guest), wsc) as gws:
        await next_event(mws, "ready")
        await next_event(gws, "ready")
        # Joining it straight through the WebSocket is refused.
        await mws.send_json({"type": "voice.update", "data": {"channel_id": vid}})
        assert (await next_event(mws, "error"))["message"] == "Voice channel not found"
        # Who's in it stays hidden from outsiders.
        await gws.send_json({"type": "voice.update", "data": {"channel_id": vid}})
        assert (await next_event(gws, "voice.state"))["user_id"] == guest.id
        await no_event(mws, "voice.state")
    assert all(v["channel_id"] != vid for v in (await member.get(f"/servers/{sid}")).json()["voice_states"])


async def test_private_addon_channel(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    sid = (await make_server(owner, member))["id"]
    channel = await create_private(owner, sid, "addon", addon_key="kanban")
    cid = channel["id"]
    assert {(o["target_id"], o["deny"]) for o in channel["overrides"]} == {(sid, VIEW)}
    assert (await owner.get(f"/addons/kanban/channels/{cid}")).status_code == 200
    assert (await member.get(f"/addons/kanban/channels/{cid}")).status_code == 404
    assert cid not in seen_by((await member.get(f"/servers/{sid}")).json())


async def test_private_channel_rules(client: AsyncClient) -> None:
    owner, mod, member = [await make_user(client, n) for n in ("owner", "mod", "member")]
    other = await make_server(member, name="Other")
    sid = (await make_server(owner, mod, member))["id"]
    top = await create_role(owner, sid, "Top")
    builders = await create_role(owner, sid, "Builders", Perm.MANAGE_CHANNELS)
    await give(owner, sid, mod, builders)
    low = await create_role(owner, sid, "Low")
    create = lambda user, **body: user.post(f"/servers/{sid}/channels", {"name": "x", **body})  # noqa: E731

    # Picking who may see it only makes sense in a private channel.
    assert (await create(owner, allowed_members=[member.id])).status_code == 422
    # Making it private edits permissions, so it needs MANAGE_ROLES like the Permissions tab.
    assert (await create(mod, private=True)).status_code == 403
    await owner.patch(f"/roles/{builders['id']}", {"permissions": int(Perm.MANAGE_CHANNELS | Perm.MANAGE_ROLES)})
    # Roles and members must be of this server, and ranked below the creator.
    assert (await create(mod, private=True, allowed_roles=[other["id"]])).status_code == 404
    assert (await create(mod, private=True, allowed_members=[(await make_user(client, "x")).id])).status_code == 404
    assert (await create(mod, private=True, allowed_roles=[top["id"]])).status_code == 403
    assert (await create(mod, private=True, allowed_members=[owner.id])).status_code == 403
    # A refused request leaves no channel behind.
    names = [c["name"] for c in (await owner.get(f"/servers/{sid}")).json()["channels"]]
    assert "x" not in names

    # The creator keeps access even without picking their own role.
    res = await create(mod, private=True, allowed_roles=[low["id"]])
    assert res.status_code == 201, res.text
    channel = res.json()
    assert (mod.id, VIEW) in {(o["target_id"], o["allow"]) for o in channel["overrides"]}
    assert channel["id"] in seen_by((await mod.get(f"/servers/{sid}")).json())
    # The owner sees everything, so no override is added for them.
    channel = await create_private(owner, sid)
    assert [o["target_id"] for o in channel["overrides"]] == [sid]
