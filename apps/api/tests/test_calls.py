from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from httpx_ws import AsyncWebSocketSession, aconnect_ws
from sqlalchemy import update

from app.db import SessionLocal
from app.models import Call
from tests.helpers import ApiUser, make_server, make_user, ws_client
from tests.test_dms import open_dm
from tests.test_friends import befriend
from tests.test_ws import next_event, no_event, ws_url


async def friends_dm(client: AsyncClient) -> tuple[ApiUser, ApiUser, dict]:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await befriend(ana, bia)
    return ana, bia, await open_dm(ana, bia)


async def join(ws: AsyncWebSocketSession, channel_id: str) -> None:
    await ws.send_json({"type": "voice.update", "data": {"channel_id": channel_id}})


def participant(call: dict, user: ApiUser) -> dict:
    return next(p for p in call["participants"] if p["user_id"] == user.id)


async def call_update(ws: AsyncWebSocketSession, until: Callable[[dict], bool]) -> dict:
    """The next call.updated that matches (earlier ones may still be queued)."""
    while not until(event := await next_event(ws, "call.updated")):
        pass
    return event


async def test_start_ring_join_and_end(client: AsyncClient) -> None:
    ana, bia, dm = await friends_dm(client)
    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as aws, aconnect_ws(ws_url(bia), wsc) as bws:
        await next_event(aws, "ready")
        await next_event(bws, "ready")

        # No call yet: no token, and the WebSocket refuses to join.
        assert (await ana.post(f"/channels/{dm['id']}/voice/token")).status_code == 409
        await join(aws, dm["id"])
        assert (await next_event(aws, "error"))["message"] == "Voice channel not found"

        res = await ana.post(f"/channels/{dm['id']}/call")
        assert res.status_code == 201
        call = res.json()
        assert call["channel_id"] == dm["id"] and call["started_by"] == ana.id and call["ended_at"] is None
        assert participant(call, ana)["rung_at"] is None and participant(call, bia)["rung_at"] is not None

        # bia is rung, gets the DM (it was hidden for her) and the call line.
        assert (await next_event(bws, "dm.created"))["id"] == dm["id"]
        line = await next_event(bws, "message.created")
        assert line["call"]["id"] == call["id"] and line["author"]["id"] == ana.id
        assert (await next_event(bws, "call.ringing"))["id"] == call["id"]
        # Starting again returns the same call.
        again = await bia.post(f"/channels/{dm['id']}/call")
        assert again.status_code == 200 and again.json()["id"] == call["id"]

        assert (await ana.post(f"/channels/{dm['id']}/voice/token")).status_code == 200
        await join(aws, dm["id"])
        state = await next_event(bws, "voice.state")
        assert state["server_id"] is None and state["dm_id"] == dm["id"] and state["state"]["channel_id"] == dm["id"]
        await call_update(bws, lambda c: participant(c, ana)["joined_at"] is not None)
        await join(bws, dm["id"])
        await call_update(aws, lambda c: participant(c, bia)["joined_at"] is not None)

        listed = (await bia.get("/dms")).json()[0]
        assert listed["call"]["id"] == call["id"]
        assert {v["user_id"] for v in listed["voice_states"]} == {ana.id, bia.id}

        await aws.send_json({"type": "voice.update", "data": {"channel_id": None}})
        left = await call_update(bws, lambda c: participant(c, ana)["left_at"] is not None)
        assert left["ended_at"] is None

        await bws.send_json({"type": "voice.update", "data": {"channel_id": None}})
        await call_update(aws, lambda c: c["ended_at"] is not None)
        line = await next_event(aws, "message.updated")
        assert line["call"]["ended_at"] is not None

    assert (await bia.get("/dms")).json()[0]["call"] is None
    assert (await ana.post(f"/channels/{dm['id']}/voice/token")).status_code == 409


async def test_only_friends_call_and_not_in_servers(client: AsyncClient) -> None:
    ana, bia, dm = await friends_dm(client)
    server = await make_server(ana)
    text = next(c["id"] for c in server["channels"] if c["type"] == "text")
    assert (await ana.post(f"/channels/{text}/call")).status_code == 400

    eve = await make_user(client, "eve")
    assert (await eve.post(f"/channels/{dm['id']}/call")).status_code == 404
    await bia.delete(f"/friends/{ana.id}")
    assert (await ana.post(f"/channels/{dm['id']}/call")).status_code == 403


async def test_decline_and_missed_calls(client: AsyncClient) -> None:
    ana, bia, dm = await friends_dm(client)
    call = (await ana.post(f"/channels/{dm['id']}/call")).json()
    assert (await ana.post(f"/calls/{call['id']}/decline")).status_code == 409  # the caller isn't rung
    assert (await bia.post(f"/calls/{call['id']}/decline")).status_code == 204
    detail = (await bia.get("/dms")).json()[0]["call"]
    assert participant(detail, bia)["declined_at"] is not None
    assert (await bia.get("/calls/missed")).json() == []  # declined isn't missed

    # A ring that timed out without an answer is a missed call until the DM is read.
    async with SessionLocal() as session:
        await session.execute(update(Call).values(ended_at=datetime.now(UTC)))
        await session.commit()
    call = (await ana.post(f"/channels/{dm['id']}/call")).json()
    async with SessionLocal() as session:
        await session.execute(update(Call).where(Call.id == call["id"]).values(ended_at=datetime.now(UTC)))
        await session.commit()
    missed = (await bia.get("/calls/missed")).json()
    assert [c["id"] for c in missed] == [call["id"]]
    assert (await ana.get("/calls/missed")).json() == []

    await bia.post(f"/channels/{dm['id']}/read")
    assert (await bia.get("/calls/missed")).json() == []


async def test_abandoned_call_ends(client: AsyncClient) -> None:
    ana, bia, dm = await friends_dm(client)
    call = (await ana.post(f"/channels/{dm['id']}/call")).json()
    async with SessionLocal() as session:
        long_ago = datetime.now(UTC) - timedelta(minutes=5)
        await session.execute(update(Call).where(Call.id == call["id"]).values(started_at=long_ago))
        await session.commit()
    # Nobody ever joined: the next look at it ends it, and a new call can start.
    assert (await bia.get("/dms")).json()[0]["call"] is None
    res = await bia.post(f"/channels/{dm['id']}/call")
    assert res.status_code == 201 and res.json()["id"] != call["id"]


async def test_ring_more_people_into_a_group_call(client: AsyncClient) -> None:
    ana, bia, cai, eve = (
        await make_user(client, "ana"),
        await make_user(client, "bia"),
        await make_user(client, "cai"),
        await make_user(client, "eve"),
    )
    await befriend(ana, bia)
    await befriend(ana, cai)
    group = (await ana.post("/dms/groups", {"user_ids": [bia.id]})).json()
    call = (await ana.post(f"/channels/{group['id']}/call")).json()

    assert (await ana.post(f"/calls/{call['id']}/ring", {"user_ids": [eve.id]})).status_code == 403
    assert (await eve.post(f"/calls/{call['id']}/ring", {"user_ids": [cai.id]})).status_code == 404

    async with ws_client() as wsc, aconnect_ws(ws_url(cai), wsc) as cws:
        await next_event(cws, "ready")
        res = await ana.post(f"/calls/{call['id']}/ring", {"user_ids": [cai.id]})
        assert res.status_code == 200 and res.json()["id"] == call["id"]
        assert (await next_event(cws, "dm.created"))["id"] == group["id"]
        assert (await next_event(cws, "call.ringing"))["id"] == call["id"]
    members = {m["user"]["id"] for m in (await cai.get("/dms")).json()[0]["members"]}
    assert members == {ana.id, bia.id, cai.id}

    # Ringing again someone who declined rings them anew.
    await bia.post(f"/calls/{call['id']}/decline")
    rung = (await ana.post(f"/calls/{call['id']}/ring", {"user_ids": [bia.id]})).json()
    assert participant(rung, bia)["declined_at"] is None


async def test_adding_someone_to_a_dm_call_moves_it_to_a_group(client: AsyncClient) -> None:
    ana, bia, dm = await friends_dm(client)
    cai = await make_user(client, "cai")
    await befriend(ana, cai)
    call = (await ana.post(f"/channels/{dm['id']}/call")).json()

    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as aws, aconnect_ws(ws_url(cai), wsc) as cws:
        await next_event(aws, "ready")
        await next_event(cws, "ready")
        await join(aws, dm["id"])
        await next_event(aws, "voice.state")

        res = await ana.post(f"/calls/{call['id']}/ring", {"user_ids": [cai.id]})
        assert res.status_code == 200
        moved_call = res.json()
        assert moved_call["channel_id"] != dm["id"]
        # ana is in the old call, so she's moved, not rung; bia and cai are rung in the group.
        assert participant(moved_call, ana)["rung_at"] is None
        assert participant(moved_call, bia)["rung_at"] is not None
        assert participant(moved_call, cai)["rung_at"] is not None

        moved = await next_event(aws, "call.moved")
        assert moved["from_call_id"] == call["id"] and moved["call"]["id"] == moved_call["id"]
        assert (await next_event(cws, "call.ringing"))["id"] == moved_call["id"]
        await no_event(cws, "call.moved")

        group = next(d for d in (await cai.get("/dms")).json() if d["id"] == moved_call["channel_id"])
        assert group["type"] == "group_dm" and len(group["members"]) == 3
        # The 1:1 DM stays private.
        assert (await cai.get(f"/channels/{dm['id']}/messages")).status_code == 404

        # ana switches over; the old call ends when she leaves it.
        await join(aws, moved_call["channel_id"])
        await call_update(aws, lambda c: c["id"] == call["id"] and c["ended_at"] is not None)


async def test_blocked_members_arent_rung(client: AsyncClient) -> None:
    ana, bia, cai = await make_user(client, "ana"), await make_user(client, "bia"), await make_user(client, "cai")
    await befriend(ana, bia)
    await befriend(ana, cai)
    group = (await ana.post("/dms/groups", {"user_ids": [bia.id, cai.id]})).json()
    await cai.post(f"/friends/{bia.id}/block")
    call = (await bia.post(f"/channels/{group['id']}/call")).json()
    assert {p["user_id"] for p in call["participants"] if p["rung_at"]} == {ana.id}


async def test_leaving_a_group_leaves_its_call(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await befriend(ana, bia)
    group = (await ana.post("/dms/groups", {"user_ids": [bia.id]})).json()
    await ana.post(f"/channels/{group['id']}/call")
    async with ws_client() as wsc, aconnect_ws(ws_url(bia), wsc) as bws:
        await next_event(bws, "ready")
        await join(bws, group["id"])
        await next_event(bws, "voice.state")
        await bia.delete(f"/dms/{group['id']}")
        assert (await next_event(bws, "voice.state"))["state"] is None
