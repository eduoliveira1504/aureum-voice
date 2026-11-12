"""Block 4.1.2: everyone in a room stays on its list, also with the app open on two devices or a
connection that drops for a moment."""

import asyncio
from contextlib import AsyncExitStack

import pytest
from httpx import AsyncClient
from httpx_ws import aconnect_ws

from app import voice
from app.routers import ws as ws_router
from tests.helpers import ApiUser, make_server, make_user, ws_client
from tests.test_voice import voice_channel
from tests.test_ws import next_event, no_event

PC = "device-pc-0001"
NOTEBOOK = "device-notebook-0002"


def url(user: ApiUser, device: str | None = None) -> str:
    return f"/ws?token={user.token}" + (f"&device={device}" if device else "")


async def in_room(owner: ApiUser, server: dict) -> list[str]:
    return sorted(s["user_id"] for s in (await owner.get(f"/servers/{server['id']}")).json()["voice_states"])


@pytest.fixture
def short_grace(monkeypatch: pytest.MonkeyPatch) -> float:
    monkeypatch.setattr(voice, "RECONNECT_GRACE_SECONDS", 0.3)
    return 0.3


@pytest.mark.parametrize("count", [5, 9, 12])
async def test_everyone_in_the_room_is_listed(client: AsyncClient, count: int) -> None:
    people = [await make_user(client, f"p{i}") for i in range(count)]
    server = await make_server(people[0], *people[1:])
    vid = voice_channel(server)
    async with ws_client() as wsc, AsyncExitStack() as stack:
        watcher = await stack.enter_async_context(aconnect_ws(url(people[0], "watcher-0000"), wsc))
        await next_event(watcher, "ready")
        for i, person in enumerate(people):
            conn = await stack.enter_async_context(aconnect_ws(url(person, f"device-{i:08d}"), wsc))
            await next_event(conn, "ready")
            await conn.send_json({"type": "voice.update", "data": {"channel_id": vid}})
            assert (await next_event(watcher, "voice.state"))["user_id"] == person.id
        assert await in_room(people[0], server) == sorted(p.id for p in people)


async def test_the_other_device_saying_not_in_a_call_changes_nothing(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia)
    vid = voice_channel(server)
    async with ws_client() as wsc, aconnect_ws(url(ana), wsc) as watcher, aconnect_ws(url(bia, PC), wsc) as pc:
        await next_event(watcher, "ready")
        await next_event(pc, "ready")
        await pc.send_json({"type": "voice.update", "data": {"channel_id": vid}})
        await next_event(watcher, "voice.state")

        # Bia's notebook opens (or reconnects) while idle: it says "not in a call".
        async with aconnect_ws(url(bia, NOTEBOOK), wsc) as notebook:
            ready = await next_event(notebook, "ready")
            assert ready["device"] == NOTEBOOK and ready["voice_device"] == PC
            await notebook.send_json({"type": "voice.update", "data": {"channel_id": None}})
            # An app from before devices (no id) says the same.
            async with aconnect_ws(url(bia), wsc) as old_app:
                await next_event(old_app, "ready")
                await old_app.send_json({"type": "voice.update", "data": {"channel_id": None}})
                await no_event(watcher, "voice.state")
        # Closing the notebook doesn't take her out either.
        await no_event(watcher, "voice.state")
        assert await in_room(ana, server) == [bia.id]

        # The PC leaving does.
        await pc.send_json({"type": "voice.update", "data": {"channel_id": None}})
        assert (await next_event(watcher, "voice.state"))["state"] is None
        assert await in_room(ana, server) == []


async def test_joining_from_another_device_moves_the_call(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia)
    vid = voice_channel(server)
    async with ws_client() as wsc, aconnect_ws(url(ana), wsc) as watcher, aconnect_ws(url(bia, PC), wsc) as pc:
        await next_event(watcher, "ready")
        await next_event(pc, "ready")
        await pc.send_json({"type": "voice.update", "data": {"channel_id": vid}})
        joined_at = (await next_event(watcher, "voice.state"))["state"]["joined_at"]

        async with aconnect_ws(url(bia, NOTEBOOK), wsc) as notebook:
            await next_event(notebook, "ready")
            await notebook.send_json({"type": "voice.update", "data": {"channel_id": vid}})
            # The PC learns the call went to the notebook (and leaves on its side)...
            assert await next_event(pc, "voice.device") == {"device": NOTEBOOK}
            # ...while for the others she just stays in the room, since the same moment.
            assert (await next_event(watcher, "voice.state"))["state"]["joined_at"] == joined_at
            # The PC's "not in a call" afterwards changes nothing.
            await pc.send_json({"type": "voice.update", "data": {"channel_id": None}})
            await no_event(watcher, "voice.state")
            assert await in_room(ana, server) == [bia.id]


async def sweep() -> None:
    """What the API's sweeper does every couple of seconds."""
    await voice.sweep(ws_router.is_connected, ws_router._recipients)


async def test_a_device_that_drops_has_a_grace_to_come_back(client: AsyncClient, short_grace: float) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia)
    vid = voice_channel(server)
    async with ws_client() as wsc, aconnect_ws(url(ana), wsc) as watcher:
        await next_event(watcher, "ready")
        async with aconnect_ws(url(bia, PC), wsc) as pc:
            await next_event(pc, "ready")
            await pc.send_json({"type": "voice.update", "data": {"channel_id": vid}})
            await next_event(watcher, "voice.state")
        # Dropped (a network blip) and back within the grace: nobody saw her leave.
        async with aconnect_ws(url(bia, PC), wsc) as pc:
            ready = await next_event(pc, "ready")
            assert ready["voice_device"] == PC  # so the app knows to re-send its state
            await pc.send_json({"type": "voice.update", "data": {"channel_id": vid}})
            assert (await next_event(watcher, "voice.state"))["state"] is not None
            await asyncio.sleep(short_grace * 2)
            await sweep()
            await no_event(watcher, "voice.state")
            assert await in_room(ana, server) == [bia.id]

        # Gone for good: still listed during the grace, out after it.
        await asyncio.sleep(0.05)
        await sweep()
        assert await in_room(ana, server) == [bia.id]
        await asyncio.sleep(short_grace * 2)
        await sweep()
        assert (await next_event(watcher, "voice.state"))["state"] is None
        assert await in_room(ana, server) == []


async def test_a_silent_connection_also_gets_the_grace(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, short_grace: float
) -> None:
    """The API drops a connection silent for a while; the app reconnects and keeps its place."""
    monkeypatch.setattr(ws_router, "RECEIVE_TIMEOUT_SECONDS", 0.3)
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia)
    vid = voice_channel(server)
    async with ws_client() as wsc:
        async with aconnect_ws(url(bia, PC), wsc) as pc:
            await next_event(pc, "ready")
            await pc.send_json({"type": "voice.update", "data": {"channel_id": vid}})
            await asyncio.sleep(0.6)  # Bia's pings don't arrive: the API closes her connection
        async with aconnect_ws(url(bia, PC), wsc) as pc:
            await next_event(pc, "ready")
            await pc.send_json({"type": "voice.update", "data": {"channel_id": vid}})
            await asyncio.sleep(short_grace * 2)
            await sweep()
            assert await in_room(ana, server) == [bia.id]


async def test_after_a_restart_who_doesnt_reconnect_leaves(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(voice, "RESTART_GRACE_SECONDS", 0.3)
    monkeypatch.setattr(voice, "SWEEP_SECONDS", 0.05)
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia)
    vid = voice_channel(server)

    async def nobody(*_: object) -> list:
        return []

    # Left over from before the restart: both in the room, nobody connected.
    for person, device in ((ana, PC), (bia, None)):
        await voice.set_state(voice.VoiceState(user_id=person.id, channel_id=vid), voice.server_scope(server["id"]), nobody, device)

    async with ws_client() as wsc, aconnect_ws(url(ana, PC), wsc) as pc:
        await next_event(pc, "ready")
        sweeper = asyncio.create_task(ws_router.run_voice_sweeper())
        await asyncio.sleep(0.6)
        sweeper.cancel()
        # Ana's device came back; Bia (an app from before devices) didn't.
        assert await in_room(ana, server) == [ana.id]
