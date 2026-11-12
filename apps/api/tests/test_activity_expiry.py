"""Block 4.1.3: "Jogando X" only while it's true. An activity left behind by a connection that's
gone never shows, and one that stops being re-confirmed goes away."""

import asyncio
import json
import uuid

import pytest
from httpx import AsyncClient
from httpx_ws import aconnect_ws

from app import presence
from app.config import get_settings
from app.realtime import broker
from tests.helpers import ApiUser, make_server, make_user, ws_client
from tests.test_presence import activity_of
from tests.test_ws import next_event, ws_url

DEVICE = "device-pc-0001"


def activity_key(user: ApiUser) -> str:
    return f"{get_settings().redis_prefix}:presence-activity:{user.id}"


async def leave_behind(user: ApiUser, name: str = "VALORANT", started_at: str = "2026-10-27T20:00:00+00:00") -> str:
    """What an API process that died before cleaning up leaves: an activity of a connection that's gone."""
    connection_id = uuid.uuid4().hex
    activity = {"type": "playing", "name": name, "started_at": started_at}
    await broker.redis.hset(activity_key(user), connection_id, json.dumps(activity))
    return connection_id


async def test_an_activity_of_a_connection_thats_gone_never_shows(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await make_server(ana, bia)
    orphan = await leave_behind(bia)

    async with ws_client() as wsc, aconnect_ws(ws_url(bia), wsc) as pc:
        await next_event(pc, "ready")  # Bia opens the app, playing nothing
        async with aconnect_ws(ws_url(ana), wsc) as aws:
            await next_event(aws, "ready")
            assert await next_event(aws, "activity.snapshot") == {}
        # ...and the orphan is gone from Redis.
        assert not await broker.redis.hexists(activity_key(bia), orphan)

        # What she really plays still shows.
        async with aconnect_ws(ws_url(ana), wsc) as aws:
            await next_event(aws, "ready")
            await next_event(aws, "activity.snapshot")
            await pc.send_json({"type": "activity.set", "data": {"name": "Minecraft"}})
            assert (await activity_of(aws, bia))["name"] == "Minecraft"


async def test_the_sweeper_takes_orphans_away_from_everyone(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await make_server(ana, bia)
    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as aws:
        await next_event(aws, "ready")
        async with aconnect_ws(ws_url(bia), wsc) as pc:
            await next_event(pc, "ready")
            await pc.send_json({"type": "activity.set", "data": {"name": "VALORANT"}})
            assert (await activity_of(aws, bia))["name"] == "VALORANT"
            # Her connection dies without cleaning up (the API process was killed): its entry stays.
            [connection_id] = await broker.redis.hkeys(activity_key(bia))
            await broker.redis.zrem(broker.presence_key(uuid.UUID(bia.id)), connection_id)
            await broker.redis.zadd(broker.presence_key(uuid.UUID(bia.id)), {"other-live-connection": 9e12})
            await presence.sweep_activities()
            assert await activity_of(aws, bia) is None


async def test_a_reconfirmed_activity_keeps_its_start_and_an_abandoned_one_expires(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(presence, "ACTIVITY_TTL_SECONDS", 0.4)
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await make_server(ana, bia)
    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as aws:
        await next_event(aws, "ready")
        async with aconnect_ws(f"{ws_url(bia)}&device={DEVICE}", wsc) as pc:
            await next_event(pc, "ready")
            await pc.send_json({"type": "activity.set", "data": {"name": "VALORANT"}})
            started = (await activity_of(aws, bia))["started_at"]

            # Re-confirmed in time: still there, same start.
            for _ in range(3):
                await asyncio.sleep(0.25)
                await pc.send_json({"type": "activity.set", "data": {"name": "VALORANT"}})
            await asyncio.sleep(0.1)
            await presence.sweep_activities()
            snapshot = (await presence.activities([uuid.UUID(bia.id)]))[uuid.UUID(bia.id)]
            assert snapshot == {"type": "playing", "name": "VALORANT", "started_at": started}

            # The app stops confirming (closed the game but the "stopped" never arrived): gone.
            await asyncio.sleep(0.5)
            await presence.sweep_activities()
            assert await activity_of(aws, bia) is None


async def test_apps_without_a_device_id_dont_expire(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """The 0.2.0-beta.10 app doesn't re-confirm: its activity lasts as long as its connection."""
    monkeypatch.setattr(presence, "ACTIVITY_TTL_SECONDS", 0.1)
    bia = await make_user(client, "bia")
    async with ws_client() as wsc, aconnect_ws(ws_url(bia), wsc) as pc:
        await next_event(pc, "ready")
        await pc.send_json({"type": "activity.set", "data": {"name": "VALORANT"}})
        await asyncio.sleep(0.3)
        await presence.sweep_activities()
        assert (await presence.activities([uuid.UUID(bia.id)]))[uuid.UUID(bia.id)]["name"] == "VALORANT"


async def test_startup_drops_every_stored_activity(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(presence, "ACTIVITY_SWEEP_SECONDS", 10)
    bia = await make_user(client, "bia")
    await leave_behind(bia)
    sweeper = asyncio.create_task(presence.run_activity_sweeper())
    await asyncio.sleep(0.2)
    sweeper.cancel()
    assert not await broker.redis.exists(activity_key(bia))
