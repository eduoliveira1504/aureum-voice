"""Nicknames and voice moderation (server mute, server deafen, moving people between rooms)."""

import jwt
from httpx import AsyncClient
from httpx_ws import aconnect_ws

from app.config import get_settings
from app.permissions import DEFAULT_EVERYONE, Perm
from tests.helpers import ApiUser, make_server, make_user, ws_client
from tests.test_roles import create_role, give
from tests.test_voice import voice_channel
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


def token_claims(token: str) -> dict:
    return jwt.decode(token, get_settings().livekit_api_secret, algorithms=["HS256"])["video"]


async def voice_token(user: ApiUser, channel_id: str) -> dict:
    res = await user.post(f"/channels/{channel_id}/voice/token")
    assert res.status_code == 200, res.text
    return token_claims(res.json()["token"])


async def test_server_mute_and_deafen(client: AsyncClient, livekit_calls: list) -> None:
    owner, mod, alice = [await make_user(client, n) for n in ("owner", "mod", "alice")]
    server = await make_server(owner, mod, alice)
    sid, vid = server["id"], voice_channel(server)
    mods = await create_role(owner, sid, "Mods", Perm.MUTE_MEMBERS)
    await give(owner, sid, mod, mods)

    async with ws_client() as wsc, aconnect_ws(ws_url(alice), wsc) as aws, aconnect_ws(ws_url(owner), wsc) as ows:
        await next_event(aws, "ready")
        await next_event(ows, "ready")
        await aws.send_json({"type": "voice.update", "data": {"channel_id": vid, "muted": False}})
        assert (await next_event(ows, "voice.state"))["state"]["muted"] is False

        res = await mod.patch(f"/servers/{sid}/members/{alice.id}/voice", {"muted": True})
        assert res.status_code == 200 and res.json()["voice_muted"] is True
        state = (await next_event(ows, "voice.state"))["state"]
        assert (state["muted"], state["server_muted"]) == (True, True)
        # LiveKit takes the mic away and mutes the published one.
        methods = [(m, room, body.get("identity")) for m, room, body in livekit_calls]
        assert methods == [("UpdateParticipant", vid, alice.id), ("GetParticipant", vid, alice.id), ("MutePublishedTrack", vid, alice.id)]
        assert "MICROPHONE" not in livekit_calls[0][2]["permission"]["canPublishSources"]

        # The client can't unmute itself.
        await aws.send_json({"type": "voice.update", "data": {"channel_id": vid, "muted": False}})
        assert (await next_event(ows, "voice.state"))["state"]["muted"] is True

    # It lasts across calls: the next token has no mic.
    assert "microphone" not in (await voice_token(alice, vid))["canPublishSources"]

    # Deafen needs its own permission; the owner has it.
    assert (await mod.patch(f"/servers/{sid}/members/{alice.id}/voice", {"deafened": True})).status_code == 403
    assert (await owner.patch(f"/servers/{sid}/members/{alice.id}/voice", {"deafened": True, "muted": False})).status_code == 200
    claims = await voice_token(alice, vid)
    assert claims["canSubscribe"] is False and "microphone" not in claims["canPublishSources"]

    await owner.patch(f"/servers/{sid}/members/{alice.id}/voice", {"deafened": False})
    claims = await voice_token(alice, vid)
    assert claims["canSubscribe"] is True and "microphone" in claims["canPublishSources"]

    # Nobody moderates someone ranked at or above them.
    assert (await mod.patch(f"/servers/{sid}/members/{owner.id}/voice", {"muted": True})).status_code == 403
    assert (await alice.patch(f"/servers/{sid}/members/{mod.id}/voice", {"muted": True})).status_code == 403


async def test_move_between_rooms(client: AsyncClient) -> None:
    owner, mover, alice = [await make_user(client, n) for n in ("owner", "mover", "alice")]
    server = await make_server(owner, mover, alice)
    sid, lobby = server["id"], voice_channel(server)
    movers = await create_role(owner, sid, "Movers", Perm.MOVE_MEMBERS)
    await give(owner, sid, mover, movers)
    games = (await owner.post(f"/servers/{sid}/channels", {"name": "Jogos", "type": "voice"})).json()["id"]
    vip = (await owner.post(f"/servers/{sid}/channels", {"name": "VIP", "type": "voice"})).json()["id"]
    await owner.put(f"/channels/{vip}/overrides/member/{alice.id}", {"deny": int(Perm.CONNECT)})

    # Only someone in a room can be moved.
    assert (await mover.patch(f"/servers/{sid}/members/{alice.id}/voice", {"channel_id": games})).status_code == 409

    async with ws_client() as wsc, aconnect_ws(ws_url(alice), wsc) as aws:
        await next_event(aws, "ready")
        await aws.send_json({"type": "voice.update", "data": {"channel_id": lobby}})
        await next_event(aws, "voice.state")

        res = await mover.patch(f"/servers/{sid}/members/{alice.id}/voice", {"channel_id": games})
        assert res.status_code == 200
        assert await next_event(aws, "voice.moved") == {"server_id": sid, "channel_id": games}
        detail = (await owner.get(f"/servers/{sid}")).json()
        assert [(v["user_id"], v["channel_id"]) for v in detail["voice_states"]] == [(alice.id, games)]

        # Not into a room they can't join, nor a text channel.
        assert (await mover.patch(f"/servers/{sid}/members/{alice.id}/voice", {"channel_id": vip})).status_code == 403
        text = next(c["id"] for c in server["channels"] if c["type"] == "text")
        assert (await mover.patch(f"/servers/{sid}/members/{alice.id}/voice", {"channel_id": text})).status_code == 404
        # Without MOVE_MEMBERS, no.
        assert (await alice.patch(f"/servers/{sid}/members/{alice.id}/voice", {"channel_id": lobby})).status_code == 403
