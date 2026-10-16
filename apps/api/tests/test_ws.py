import asyncio
from typing import Any

import pytest
from httpx import AsyncClient
from httpx_ws import AsyncWebSocketSession, WebSocketDisconnect, aconnect_ws

from tests.helpers import ApiUser, make_server, make_user, text_channel, ws_client


async def next_event(ws: AsyncWebSocketSession, type_: str, timeout: float = 5) -> dict[str, Any]:
    """Skips unrelated events (e.g. presence) until one of the given type arrives."""
    async with asyncio.timeout(timeout):
        while True:
            event = await ws.receive_json()
            if event["type"] == type_:
                return event["data"]


async def no_event(ws: AsyncWebSocketSession, type_: str, wait: float = 0.5) -> None:
    try:
        async with asyncio.timeout(wait):
            while (await ws.receive_json())["type"] != type_:
                pass
        pytest.fail(f"unexpected {type_} event")
    except TimeoutError:
        pass


def ws_url(user: ApiUser) -> str:
    return f"/ws?token={user.token}"


async def test_rejects_invalid_token(client: AsyncClient) -> None:
    codes = []
    try:
        async with ws_client() as wsc, aconnect_ws("/ws?token=garbage", wsc) as ws:
            await ws.receive_json()
    except* WebSocketDisconnect as group:  # the transport's task groups wrap (and nest) the error
        codes = [e.code for e in _leaves(group) if isinstance(e, WebSocketDisconnect)]
    assert codes == [4401]


def _leaves(exc: BaseException) -> list[BaseException]:
    if isinstance(exc, BaseExceptionGroup):
        return [leaf for sub in exc.exceptions for leaf in _leaves(sub)]
    return [exc]


async def test_message_events_reach_members_only(client: AsyncClient) -> None:
    owner, friend, stranger = (
        await make_user(client, "owner"),
        await make_user(client, "friend"),
        await make_user(client, "stranger"),
    )
    cid = text_channel(await make_server(owner, friend))

    async with ws_client() as wsc, aconnect_ws(ws_url(friend), wsc) as fws, aconnect_ws(ws_url(stranger), wsc) as sws:
        await next_event(fws, "ready")
        await next_event(sws, "ready")

        msg = (await owner.post(f"/channels/{cid}/messages", {"content": "hey"})).json()
        created = await next_event(fws, "message.created")
        assert created["id"] == msg["id"] and created["content"] == "hey"

        await owner.patch(f"/messages/{msg['id']}", {"content": "hey!"})
        assert (await next_event(fws, "message.updated"))["content"] == "hey!"

        await owner.delete(f"/messages/{msg['id']}")
        assert await next_event(fws, "message.deleted") == {"id": msg["id"], "channel_id": cid}

        await no_event(sws, "message.created")


async def test_membership_and_presence_events(client: AsyncClient) -> None:
    owner, friend = await make_user(client, "owner"), await make_user(client, "friend")
    server = await make_server(owner)

    async with ws_client() as wsc, aconnect_ws(ws_url(owner), wsc) as ows:
        await next_event(ows, "ready")

        code = (await owner.post(f"/servers/{server['id']}/invites", {})).json()["code"]
        await friend.post(f"/invites/{code}/join")
        joined = await next_event(ows, "server.member.joined")
        assert joined["member"]["user"]["id"] == friend.id and joined["member"]["online"] is False

        async with aconnect_ws(ws_url(friend), wsc) as fws:
            await next_event(fws, "ready")
            assert await next_event(ows, "presence.updated") == {"user_id": friend.id, "online": True}
            detail = (await owner.get(f"/servers/{server['id']}")).json()
            assert {m["user"]["id"]: m["online"] for m in detail["members"]} == {owner.id: True, friend.id: True}

        assert await next_event(ows, "presence.updated") == {"user_id": friend.id, "online": False}

        await owner.post(f"/servers/{server['id']}/channels", {"name": "Lobby", "type": "voice"})
        assert (await next_event(ows, "channel.created"))["name"] == "Lobby"


async def test_ping_pong(client: AsyncClient) -> None:
    user = await make_user(client, "pinger")
    async with ws_client() as wsc, aconnect_ws(ws_url(user), wsc) as ws:
        await next_event(ws, "ready")
        await ws.send_json({"type": "ping"})
        await next_event(ws, "pong")
