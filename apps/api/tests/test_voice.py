import jwt
from httpx import AsyncClient
from httpx_ws import aconnect_ws

from app.config import get_settings
from tests.helpers import make_server, make_user, ws_client
from tests.test_ws import next_event, no_event


def voice_channel(server: dict) -> str:
    return next(c["id"] for c in server["channels"] if c["type"] == "voice")


async def test_voice_token(client: AsyncClient) -> None:
    owner, stranger = await make_user(client, "owner"), await make_user(client, "stranger")
    server = await make_server(owner)
    vid = voice_channel(server)
    text = next(c["id"] for c in server["channels"] if c["type"] == "text")

    res = await owner.post(f"/channels/{vid}/voice/token")
    assert res.status_code == 200
    settings = get_settings()
    claims = jwt.decode(res.json()["token"], settings.livekit_api_secret, algorithms=["HS256"])
    assert claims["iss"] == settings.livekit_api_key
    assert claims["sub"] == owner.id
    assert claims["video"]["room"] == vid and claims["video"]["roomJoin"] is True
    assert res.json()["url"] == settings.livekit_url

    assert (await owner.post(f"/channels/{text}/voice/token")).status_code == 400
    assert (await stranger.post(f"/channels/{vid}/voice/token")).status_code == 404


async def test_voice_state_lifecycle(client: AsyncClient) -> None:
    owner, friend, stranger = (
        await make_user(client, "owner"),
        await make_user(client, "friend"),
        await make_user(client, "stranger"),
    )
    server = await make_server(owner, friend)
    vid = voice_channel(server)

    async with ws_client() as wsc, aconnect_ws(f"/ws?token={owner.token}", wsc) as ows:
        await next_event(ows, "ready")

        async with aconnect_ws(f"/ws?token={friend.token}", wsc) as fws:
            await next_event(fws, "ready")
            await fws.send_json({"type": "voice.update", "data": {"channel_id": vid, "muted": True}})
            event = await next_event(ows, "voice.state")
            assert event["user_id"] == friend.id and event["server_id"] == server["id"]
            assert event["state"]["channel_id"] == vid and event["state"]["muted"] is True

            detail = (await owner.get(f"/servers/{server['id']}")).json()
            assert [(s["user_id"], s["muted"]) for s in detail["voice_states"]] == [(friend.id, True)]

            await fws.send_json({"type": "voice.update", "data": {"channel_id": vid, "camera": True}})
            assert (await next_event(ows, "voice.state"))["state"]["camera"] is True

            # Non-members and text channels are rejected.
            await fws.send_json({"type": "voice.update", "data": {"channel_id": server["channels"][0]["id"]}})
            assert (await next_event(fws, "error"))["message"] == "Voice channel not found"

        # Closing the last connection drops the user from voice.
        assert (await next_event(ows, "voice.state"))["state"] is None
        detail = (await owner.get(f"/servers/{server['id']}")).json()
        assert detail["voice_states"] == []

        async with aconnect_ws(f"/ws?token={stranger.token}", wsc) as sws:
            await next_event(sws, "ready")
            await sws.send_json({"type": "voice.update", "data": {"channel_id": vid}})
            await next_event(sws, "error")
        await no_event(ows, "voice.state")


async def test_explicit_leave_and_channel_delete(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    server = await make_server(owner)
    vid = voice_channel(server)

    async with ws_client() as wsc, aconnect_ws(f"/ws?token={owner.token}", wsc) as ws:
        await next_event(ws, "ready")
        await ws.send_json({"type": "voice.update", "data": {"channel_id": vid}})
        assert (await next_event(ws, "voice.state"))["state"]["channel_id"] == vid
        await ws.send_json({"type": "voice.update", "data": {"channel_id": None}})
        assert (await next_event(ws, "voice.state"))["state"] is None

        await ws.send_json({"type": "voice.update", "data": {"channel_id": vid}})
        await next_event(ws, "voice.state")
        await owner.delete(f"/channels/{vid}")
        assert (await next_event(ws, "voice.state"))["state"] is None
