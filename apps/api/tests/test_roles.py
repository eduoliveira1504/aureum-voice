"""Roles, channel overrides, kicks and bans through the API."""

from typing import Any

import jwt
from httpx import AsyncClient
from httpx_ws import aconnect_ws

from app.config import get_settings
from app.permissions import DEFAULT_EVERYONE, Perm
from tests.helpers import ApiUser, make_server, make_user, text_channel, ws_client
from tests.test_profile import GIF, PNG
from tests.test_voice import voice_channel
from tests.test_ws import next_event, no_event, ws_url


async def create_role(owner: ApiUser, server_id: str, name: str, perms: Perm = Perm(0), **extra: Any) -> dict[str, Any]:
    res = await owner.post(f"/servers/{server_id}/roles", {"name": name, "permissions": int(perms), **extra})
    assert res.status_code == 201, res.text
    return res.json()


async def give(actor: ApiUser, server_id: str, user: ApiUser, role: dict[str, Any]) -> None:
    res = await actor.put(f"/servers/{server_id}/members/{user.id}/roles/{role['id']}")
    assert res.status_code == 204, res.text


async def roles_of(user: ApiUser, server_id: str) -> list[tuple[str, int]]:
    server = (await user.get(f"/servers/{server_id}")).json()
    return [(r["name"], r["position"]) for r in server["roles"]]


async def test_restrict_a_channel_to_one_role(client: AsyncClient) -> None:
    owner, mod, member = await make_user(client, "owner"), await make_user(client, "mod"), await make_user(client, "member")
    server = await make_server(owner, mod, member)
    sid = server["id"]
    mods = await create_role(owner, sid, "Mods", hoist=True, color="#8B5CF6")
    await give(owner, sid, mod, mods)
    staff = (await owner.post(f"/servers/{sid}/channels", {"name": "staff"})).json()
    cid = staff["id"]

    assert (await owner.put(f"/channels/{cid}/overrides/role/{sid}", {"deny": int(Perm.VIEW_CHANNEL)})).status_code == 200
    res = await owner.put(f"/channels/{cid}/overrides/role/{mods['id']}", {"allow": int(Perm.VIEW_CHANNEL)})
    assert res.status_code == 200
    assert {(o["target_type"], o["allow"], o["deny"]) for o in res.json()["overrides"]} == {
        ("role", 0, int(Perm.VIEW_CHANNEL)),
        ("role", int(Perm.VIEW_CHANNEL), 0),
    }

    seen_by = lambda detail: [c["id"] for c in detail["channels"]]  # noqa: E731
    assert cid in seen_by((await mod.get(f"/servers/{sid}")).json())
    assert cid not in seen_by((await member.get(f"/servers/{sid}")).json())
    # A hidden channel doesn't exist for the member.
    assert (await member.get(f"/channels/{cid}/messages")).status_code == 404
    assert (await member.post(f"/channels/{cid}/messages", {"content": "hi"})).status_code == 404

    # Its messages and @mentions don't reach them either.
    async with ws_client() as wsc, aconnect_ws(ws_url(member), wsc) as hidden, aconnect_ws(ws_url(mod), wsc) as allowed:
        await next_event(hidden, "ready")
        await next_event(allowed, "ready")
        assert (await mod.post(f"/channels/{cid}/messages", {"content": "secret @member"})).status_code == 201
        await next_event(allowed, "message.created")
        await no_event(hidden, "message.created")
    feed = (await member.get(f"/servers/{sid}/unread")).json()
    assert all(m["channel_id"] != cid for m in feed)

    # Given the role, they see it (and they're told to refetch the server).
    async with ws_client() as wsc, aconnect_ws(ws_url(member), wsc) as ws:
        await next_event(ws, "ready")
        await give(owner, sid, member, mods)
        assert (await next_event(ws, "server.permissions.updated"))["server_id"] == sid
    assert cid in seen_by((await member.get(f"/servers/{sid}")).json())
    assert [m["content"] for m in (await member.get(f"/channels/{cid}/messages")).json()] == ["secret @member"]

    assert (await owner.delete(f"/servers/{sid}/members/{member.id}/roles/{mods['id']}")).status_code == 204
    assert cid not in seen_by((await member.get(f"/servers/{sid}")).json())


async def test_everyone_permissions_gate_the_routes(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    server = await make_server(owner, member)
    sid, cid = server["id"], text_channel(server)

    assert (await member.post(f"/servers/{sid}/channels", {"name": "x"})).status_code == 403
    assert (await member.post(f"/servers/{sid}/invites", {})).status_code == 403  # invites create accounts
    assert (await member.patch(f"/servers/{sid}", {"name": "Hacked"})).status_code == 403
    assert (await member.post(f"/servers/{sid}/roles", {"name": "x"})).status_code == 403
    assert (await member.put(f"/channels/{cid}/overrides/role/{sid}", {"deny": 1 << 9})).status_code == 403

    helpers = await create_role(owner, sid, "Helpers", Perm.CREATE_INVITE | Perm.MANAGE_CHANNELS | Perm.MANAGE_SERVER)
    await give(owner, sid, member, helpers)
    assert (await member.post(f"/servers/{sid}/invites", {})).status_code == 201
    assert (await member.post(f"/servers/{sid}/channels", {"name": "x"})).status_code == 201
    assert (await member.patch(f"/servers/{sid}", {"name": "Renamed"})).status_code == 200

    # Taking SEND_MESSAGES away from @everyone in one channel.
    assert (await member.post(f"/channels/{cid}/messages", {"content": "a"})).status_code == 201
    await owner.put(f"/channels/{cid}/overrides/role/{sid}", {"deny": int(Perm.SEND_MESSAGES)})
    assert (await member.post(f"/channels/{cid}/messages", {"content": "b"})).status_code == 403

    # Without READ_HISTORY, the history comes back empty.
    await owner.put(f"/channels/{cid}/overrides/member/{member.id}", {"deny": int(Perm.READ_HISTORY)})
    assert (await member.get(f"/channels/{cid}/messages")).json() == []
    assert len((await owner.get(f"/channels/{cid}/messages")).json()) == 1


async def test_manage_messages(client: AsyncClient) -> None:
    owner, mod, member = await make_user(client, "owner"), await make_user(client, "mod"), await make_user(client, "member")
    server = await make_server(owner, mod, member)
    sid, cid = server["id"], text_channel(server)
    message = (await member.post(f"/channels/{cid}/messages", {"content": "spam"})).json()

    assert (await mod.delete(f"/messages/{message['id']}")).status_code == 403
    await give(owner, sid, mod, await create_role(owner, sid, "Mods", Perm.MANAGE_MESSAGES))
    assert (await mod.delete(f"/messages/{message['id']}")).status_code == 204


async def test_override_validation(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    server = await make_server(owner)
    sid, cid = server["id"], text_channel(server)
    view = int(Perm.VIEW_CHANNEL)

    both = await owner.put(f"/channels/{cid}/overrides/role/{sid}", {"allow": view, "deny": view})
    assert both.status_code == 422
    server_wide = await owner.put(f"/channels/{cid}/overrides/role/{sid}", {"allow": int(Perm.BAN_MEMBERS)})
    assert server_wide.status_code == 422
    stranger = await make_user(client, "stranger")
    assert (await owner.put(f"/channels/{cid}/overrides/member/{stranger.id}", {"deny": view})).status_code == 404
    assert (await owner.delete(f"/channels/{cid}/overrides/role/{sid}")).status_code == 404

    assert (await owner.put(f"/channels/{cid}/overrides/role/{sid}", {"deny": view})).status_code == 200
    removed = await owner.delete(f"/channels/{cid}/overrides/role/{sid}")
    assert removed.status_code == 200 and removed.json()["overrides"] == []


async def test_role_crud_and_everyone(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    sid = (await make_server(owner))["id"]

    first = await create_role(owner, sid, "First")
    second = await create_role(owner, sid, "Second", Perm.KICK_MEMBERS, color="#3FBF7F", hoist=True)
    # New roles start at the bottom.
    assert await roles_of(owner, sid) == [("First", 2), ("Second", 1), ("@everyone", 0)]
    assert second["color"] == "#3FBF7F" and second["hoist"] is True

    updated = await owner.patch(f"/roles/{second['id']}", {"name": "Mods", "color": None, "mentionable": True})
    assert updated.status_code == 200
    assert (updated.json()["name"], updated.json()["color"], updated.json()["mentionable"]) == ("Mods", None, True)

    # @everyone: only its permissions change, and it can't be deleted.
    assert (await owner.patch(f"/roles/{sid}", {"name": "all"})).status_code == 400
    perms = int(DEFAULT_EVERYONE | Perm.CREATE_INVITE)
    assert (await owner.patch(f"/roles/{sid}", {"permissions": perms})).json()["permissions"] == perms
    assert (await owner.delete(f"/roles/{sid}")).status_code == 400

    reordered = await owner.put(f"/servers/{sid}/roles/order", {"role_ids": [second["id"], first["id"]]})
    assert reordered.status_code == 200
    assert [(r["name"], r["position"]) for r in reordered.json()] == [("Mods", 2), ("First", 1), ("@everyone", 0)]
    assert (await owner.put(f"/servers/{sid}/roles/order", {"role_ids": [first["id"]]})).status_code == 422

    # Deleting closes the gap and removes the role's overrides.
    cid = (await owner.post(f"/servers/{sid}/channels", {"name": "x"})).json()["id"]
    await owner.put(f"/channels/{cid}/overrides/role/{second['id']}", {"allow": int(Perm.MANAGE_MESSAGES)})
    assert (await owner.delete(f"/roles/{second['id']}")).status_code == 204
    assert await roles_of(owner, sid) == [("First", 1), ("@everyone", 0)]
    channel = next(c for c in (await owner.get(f"/servers/{sid}")).json()["channels"] if c["id"] == cid)
    assert channel["overrides"] == []


async def test_hierarchy_through_the_api(client: AsyncClient) -> None:
    owner, manager, low = await make_user(client, "owner"), await make_user(client, "manager"), await make_user(client, "low")
    sid = (await make_server(owner, manager, low))["id"]
    junior = await create_role(owner, sid, "Junior")
    managers = await create_role(owner, sid, "Managers", Perm.MANAGE_ROLES | Perm.KICK_MEMBERS)
    top = await create_role(owner, sid, "Top")  # created last: at the bottom
    await owner.put(f"/servers/{sid}/roles/order", {"role_ids": [top["id"], managers["id"], junior["id"]]})
    await give(owner, sid, manager, managers)

    # Roles at or above their own are off limits; below is fine.
    assert (await manager.patch(f"/roles/{top['id']}", {"name": "x"})).status_code == 403
    assert (await manager.patch(f"/roles/{managers['id']}", {"name": "x"})).status_code == 403
    assert (await manager.patch(f"/roles/{junior['id']}", {"name": "Newbie"})).status_code == 200
    assert (await manager.put(f"/servers/{sid}/members/{low.id}/roles/{top['id']}")).status_code == 403
    assert (await manager.put(f"/servers/{sid}/members/{manager.id}/roles/{top['id']}")).status_code == 403
    assert (await manager.put(f"/servers/{sid}/members/{low.id}/roles/{junior['id']}")).status_code == 204

    # They can't grant what they don't have.
    assert (await manager.post(f"/servers/{sid}/roles", {"name": "x", "permissions": int(Perm.ADMINISTRATOR)})).status_code == 403
    assert (await manager.patch(f"/roles/{junior['id']}", {"permissions": int(Perm.BAN_MEMBERS)})).status_code == 403
    assert (await manager.patch(f"/roles/{junior['id']}", {"permissions": int(Perm.KICK_MEMBERS)})).status_code == 200

    # Reordering can't touch their own level or above.
    created = await create_role(manager, sid, "Mine")
    order = await roles_of(owner, sid)
    assert order == [("Top", 4), ("Managers", 3), ("Newbie", 2), ("Mine", 1), ("@everyone", 0)]
    swap_below = await manager.put(f"/servers/{sid}/roles/order", {"role_ids": [top["id"], managers["id"], created["id"], junior["id"]]})
    assert swap_below.status_code == 200
    climb = await manager.put(f"/servers/{sid}/roles/order", {"role_ids": [top["id"], created["id"], managers["id"], junior["id"]]})
    assert climb.status_code == 403

    # Overrides: only for targets below them.
    cid = (await owner.post(f"/servers/{sid}/channels", {"name": "x"})).json()["id"]
    view = {"deny": int(Perm.SEND_MESSAGES)}
    assert (await manager.put(f"/channels/{cid}/overrides/role/{top['id']}", view)).status_code == 403
    assert (await manager.put(f"/channels/{cid}/overrides/member/{owner.id}", view)).status_code == 403
    assert (await manager.put(f"/channels/{cid}/overrides/role/{junior['id']}", view)).status_code == 200
    assert (await manager.put(f"/channels/{cid}/overrides/member/{low.id}", view)).status_code == 200


async def test_kick_and_ban(client: AsyncClient) -> None:
    owner, mod, a, b = [await make_user(client, n) for n in ("owner", "mod", "a", "b")]
    server = await make_server(owner, mod, a, b)
    sid = server["id"]
    mods = await create_role(owner, sid, "Mods", Perm.KICK_MEMBERS | Perm.BAN_MEMBERS)
    await give(owner, sid, mod, mods)

    assert (await a.delete(f"/servers/{sid}/members/{b.id}")).status_code == 403
    assert (await mod.delete(f"/servers/{sid}/members/{owner.id}")).status_code == 403
    assert (await mod.delete(f"/servers/{sid}/members/{mod.id}")).status_code == 400

    async with ws_client() as wsc, aconnect_ws(ws_url(a), wsc) as ws:
        await next_event(ws, "ready")
        assert (await mod.delete(f"/servers/{sid}/members/{a.id}")).status_code == 204
        assert (await next_event(ws, "server.member.left"))["user_id"] == a.id
    assert (await a.get(f"/servers/{sid}")).status_code == 404

    # A ban removes them and keeps them out.
    assert (await mod.put(f"/servers/{sid}/bans/{b.id}", {"reason": "spam"})).json()["reason"] == "spam"
    assert (await b.get(f"/servers/{sid}")).status_code == 404
    code = (await owner.post(f"/servers/{sid}/invites", {})).json()["code"]
    assert (await b.post(f"/invites/{code}/join")).status_code == 403
    assert (await a.post(f"/invites/{code}/join")).status_code == 200  # a kick is not a ban
    assert [x["user"]["id"] for x in (await mod.get(f"/servers/{sid}/bans")).json()] == [b.id]
    assert (await a.get(f"/servers/{sid}/bans")).status_code == 403

    assert (await mod.delete(f"/servers/{sid}/bans/{b.id}")).status_code == 204
    assert (await b.post(f"/invites/{code}/join")).status_code == 200

    # Mods can't remove someone ranked like them; the owner can.
    rival = await make_user(client, "rival")
    code = (await owner.post(f"/servers/{sid}/invites", {})).json()["code"]
    await rival.post(f"/invites/{code}/join")
    await give(owner, sid, rival, mods)
    assert (await mod.delete(f"/servers/{sid}/members/{rival.id}")).status_code == 403
    # Kicking takes the member's roles with them.
    assert (await owner.delete(f"/servers/{sid}/members/{rival.id}")).status_code == 204
    await rival.post(f"/invites/{code}/join")
    member = next(m for m in (await owner.get(f"/servers/{sid}")).json()["members"] if m["user"]["id"] == rival.id)
    assert member["role_ids"] == []


async def test_voice_permissions(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    server = await make_server(owner, member)
    sid, vid = server["id"], voice_channel(server)
    secret = get_settings().livekit_api_secret

    def sources(res: Any) -> list[str] | None:
        return jwt.decode(res.json()["token"], secret, algorithms=["HS256"])["video"].get("canPublishSources")

    assert set(sources(await member.post(f"/channels/{vid}/voice/token")) or []) == {
        "microphone", "camera", "screen_share", "screen_share_audio"
    }
    await owner.put(f"/channels/{vid}/overrides/role/{sid}", {"deny": int(Perm.VIDEO | Perm.STREAM)})
    assert sources(await member.post(f"/channels/{vid}/voice/token")) == ["microphone"]

    # Their reported state follows suit, and losing CONNECT throws them out of the room.
    async with ws_client() as wsc, aconnect_ws(ws_url(member), wsc) as ws, aconnect_ws(ws_url(owner), wsc) as ows:
        await next_event(ws, "ready")
        await next_event(ows, "ready")
        await ws.send_json({"type": "voice.update", "data": {"channel_id": vid, "camera": True, "screen": True}})
        state = (await next_event(ows, "voice.state"))["state"]
        assert (state["camera"], state["screen"]) == (False, False)

        await owner.put(f"/channels/{vid}/overrides/member/{member.id}", {"deny": int(Perm.CONNECT)})
        left = await next_event(ows, "voice.state")
        assert (left["user_id"], left["state"]) == (member.id, None)
        await ws.send_json({"type": "voice.update", "data": {"channel_id": vid}})
        assert (await next_event(ws, "error"))["message"] == "Voice channel not found"
    assert (await member.post(f"/channels/{vid}/voice/token")).status_code == 403


async def test_server_icon_and_banner(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    sid = (await make_server(owner, member))["id"]

    async def upload(user: ApiUser, kind: str, data: bytes):  # noqa: ANN202
        return await user.client.post(
            f"/api/servers/{sid}/{kind}", headers=user.headers, files={"file": ("x", data, "image/png")}
        )

    assert (await upload(member, "icon", PNG)).status_code == 403
    icon = (await upload(owner, "icon", PNG)).json()["icon_url"]
    banner = (await upload(owner, "banner", GIF)).json()["banner_url"]
    assert icon.startswith(f"/api/media/servers/{sid}/") and banner.endswith(".gif")
    assert (await client.get(banner)).content == GIF
    assert (await upload(owner, "banner", b"not an image")).status_code == 415

    removed = await owner.delete(f"/servers/{sid}/banner")
    assert removed.json()["banner_url"] is None
    assert (await client.get(banner)).status_code == 404

    role = await create_role(owner, sid, "Shiny")
    res = await owner.client.post(f"/api/roles/{role['id']}/icon", headers=owner.headers, files={"file": ("x", PNG, "image/png")})
    assert res.json()["icon_url"].startswith(f"/api/media/roles/{sid}/")
