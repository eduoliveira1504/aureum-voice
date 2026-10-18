"""Nicknames and voice moderation (server mute, server deafen, moving people between rooms)."""

from httpx import AsyncClient
from httpx_ws import aconnect_ws

from app.permissions import DEFAULT_EVERYONE, Perm
from tests.helpers import make_server, make_user, ws_client
from tests.test_roles import create_role, give
from tests.test_ws import next_event, ws_url


async def test_nicknames(client: AsyncClient) -> None:
    owner, mod, alice, bob = [await make_user(client, n) for n in ("owner", "mod", "alice", "bob")]
    sid = (await make_server(owner, mod, alice, bob))["id"]
    mods = await create_role(owner, sid, "Mods", Perm.MANAGE_NICKNAMES)
    await give(owner, sid, mod, mods)

    async with ws_client() as wsc, aconnect_ws(ws_url(bob), wsc) as ws:
        await next_event(ws, "ready")
        # Anyone may change their own (CHANGE_NICKNAME is on for @everyone by default).
        res = await alice.patch(f"/servers/{sid}/members/{alice.id}", {"nickname": "  Lice  "})
        assert res.status_code == 200
        assert res.json()["nickname"] == "Lice"
        event = await next_event(ws, "server.member.updated")
        assert (event["server_id"], event["member"]["nickname"]) == (sid, "Lice")

    detail = (await bob.get(f"/servers/{sid}")).json()
    assert next(m for m in detail["members"] if m["user"]["id"] == alice.id)["nickname"] == "Lice"

    # Others' need MANAGE_NICKNAMES and a higher rank.
    assert (await bob.patch(f"/servers/{sid}/members/{alice.id}", {"nickname": "x"})).status_code == 403
    assert (await mod.patch(f"/servers/{sid}/members/{alice.id}", {"nickname": "Al"})).status_code == 200
    assert (await mod.patch(f"/servers/{sid}/members/{owner.id}", {"nickname": "boss"})).status_code == 403
    assert (await owner.patch(f"/servers/{sid}/members/{mod.id}", {"nickname": "Moddy"})).status_code == 200

    # Empty clears it; too long is refused.
    assert (await alice.patch(f"/servers/{sid}/members/{alice.id}", {"nickname": ""})).json()["nickname"] is None
    assert (await alice.patch(f"/servers/{sid}/members/{alice.id}", {"nickname": "x" * 33})).status_code == 422

    # Without CHANGE_NICKNAME, not even your own.
    await owner.patch(f"/roles/{sid}", {"permissions": int(DEFAULT_EVERYONE & ~Perm.CHANGE_NICKNAME)})
    assert (await bob.patch(f"/servers/{sid}/members/{bob.id}", {"nickname": "b"})).status_code == 403
