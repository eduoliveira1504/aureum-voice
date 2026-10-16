import asyncio

import pytest
from httpx import AsyncClient
from httpx_ws import AsyncWebSocketSession, aconnect_ws

from tests.helpers import ApiUser, make_server, make_user, ws_client
from tests.test_friends import befriend
from tests.test_ws import next_event, ws_url


async def presence_of(ws: AsyncWebSocketSession, user: ApiUser) -> dict:
    """The next presence.updated about this user (our own can still be in flight)."""
    while (event := await next_event(ws, "presence.updated"))["user_id"] != user.id:
        pass
    return event


async def no_presence_of(ws: AsyncWebSocketSession, user: ApiUser, wait: float = 0.5) -> None:
    try:
        async with asyncio.timeout(wait):
            await presence_of(ws, user)
        pytest.fail("unexpected presence.updated")
    except TimeoutError:
        pass


async def statuses(client_user: ApiUser, server_id: str) -> dict[str, str]:
    detail = (await client_user.get(f"/servers/{server_id}")).json()
    return {m["user"]["id"]: m["status"] for m in detail["members"]}


async def test_chosen_statuses(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia)

    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as aws:
        await next_event(aws, "ready")
        async with aconnect_ws(ws_url(bia), wsc) as bws:
            await next_event(bws, "ready")
            assert (await presence_of(aws, bia))["status"] == "online"

            await bia.patch("/users/me/settings", {"status": "dnd"})
            assert (await presence_of(aws, bia)) == {"user_id": bia.id, "status": "dnd", "online": True}
            assert (await statuses(ana, server["id"]))[bia.id] == "dnd"

            # Invisible looks offline to everyone else.
            await bia.patch("/users/me/settings", {"status": "invisible"})
            assert (await presence_of(aws, bia))["status"] == "offline"
            assert (await statuses(ana, server["id"]))[bia.id] == "offline"
            # Unrelated settings changes don't announce anything.
            await bia.patch("/users/me/settings", {"theme": "light"})
            await no_presence_of(aws, bia)

        # Leaving while invisible: already offline for others, so nothing new is sent.
        await no_presence_of(aws, bia)

        async with aconnect_ws(ws_url(bia), wsc) as bws:
            await next_event(bws, "ready")
            await bia.patch("/users/me/settings", {"status": "online"})
            assert (await presence_of(aws, bia))["status"] == "online"


async def test_idle_needs_every_connection_idle(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await befriend(ana, bia)

    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as aws:
        await next_event(aws, "ready")
        async with aconnect_ws(ws_url(bia), wsc) as pc, aconnect_ws(ws_url(bia), wsc) as laptop:
            await next_event(pc, "ready")
            await next_event(laptop, "ready")
            assert (await presence_of(aws, bia))["status"] == "online"

            await pc.send_json({"type": "presence.idle", "data": {"idle": True}})
            await no_presence_of(aws, bia)  # the laptop is still active
            await laptop.send_json({"type": "presence.idle", "data": {"idle": True}})
            assert (await presence_of(aws, bia))["status"] == "idle"
            friends = {f["user"]["id"]: f["status"] for f in (await ana.get("/friends")).json()}
            assert friends == {bia.id: "idle"}

            await pc.send_json({"type": "presence.idle", "data": {"idle": False}})
            assert (await presence_of(aws, bia))["status"] == "online"
        assert (await presence_of(aws, bia))["status"] == "offline"


async def test_status_survives_reconnects(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await befriend(ana, bia)
    await bia.patch("/users/me/settings", {"status": "dnd"})
    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as aws:
        await next_event(aws, "ready")
        async with aconnect_ws(ws_url(bia), wsc) as bws:
            await next_event(bws, "ready")
            assert (await presence_of(aws, bia))["status"] == "dnd"
