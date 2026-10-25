"""The events addon: events, places, weekly repeats, answers, covers, permissions, the agenda."""

from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from httpx import AsyncClient
from sqlalchemy import func, select, update

from app.addons.events import occurrences
from app.addons.events.models import Event
from app.db import SessionLocal
from app.permissions import Perm
from tests.helpers import ApiUser, make_server, make_user, text_channel
from tests.test_profile import PNG
from tests.test_roles import create_role, give

ZONE = "America/Sao_Paulo"


def url(cid: str, path: str = "") -> str:
    return f"/addons/events/channels/{cid}/events{path}"


def iso(d: datetime) -> str:
    return d.isoformat()


async def events_channel(owner: ApiUser, server_id: str) -> str:
    res = await owner.post(f"/servers/{server_id}/channels", {"name": "Eventos", "type": "addon", "addon_key": "events"})
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def create(user: ApiUser, cid: str, *, in_hours: float = 48, hours: float = 2, **body: Any) -> dict[str, Any]:
    start = datetime.now(UTC).replace(microsecond=0) + timedelta(hours=in_hours)
    payload = {"title": "Noite de jogos", "starts_at": iso(start), "ends_at": iso(start + timedelta(hours=hours)), "timezone": ZONE, **body}
    res = await user.post(url(cid), payload)
    assert res.status_code == 201, res.text
    return res.json()


async def answer(user: ApiUser, cid: str, event_id: str, status: str | None) -> Any:
    return await user.put(url(cid, f"/{event_id}/response"), {"status": status})


def test_weekly_occurrences_keep_the_wall_clock() -> None:
    # 20:00 in New York, which changes from summer to winter time on 2026-11-01.
    ny = ZoneInfo("America/New_York")
    starts = datetime(2026, 10, 29, 20, 0, tzinfo=ny).astimezone(UTC)
    ends = starts + timedelta(hours=2)
    first, second = (occurrences.occurrence(starts, ends, "America/New_York", i) for i in (0, 1))
    assert first.starts_at.astimezone(ny).hour == 20 and second.starts_at.astimezone(ny).hour == 20
    assert second.starts_at - first.starts_at == timedelta(weeks=1, hours=1)
    assert second.ends_at - second.starts_at == timedelta(hours=2)

    # The one going on or next.
    now = starts + timedelta(days=8)
    current = occurrences.current(starts, ends, "America/New_York", "weekly", now)
    assert current is not None and current.index == 2
    assert occurrences.current(starts, ends, ZONE, "none", now) is None
    during = occurrences.current(starts, ends, "America/New_York", "weekly", starts + timedelta(hours=1))
    assert during is not None and during.index == 0

    found = occurrences.between(starts, ends, "America/New_York", "weekly", starts + timedelta(days=1), starts + timedelta(days=22))
    assert [o.index for o in found] == [1, 2, 3]
    assert occurrences.between(starts, ends, ZONE, "none", ends, ends + timedelta(days=1)) == []


async def test_create_and_list(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    server = await make_server(owner, member)
    cid = await events_channel(owner, server["id"])
    room = next(c["id"] for c in server["channels"] if c["type"] == "voice")
    event = await create(owner, cid, description="Traga o controle", location_channel_id=room)
    assert event["title"] == "Noite de jogos" and event["repeat"] == "none" and event["created_by"] == owner.id
    assert event["location_channel_id"] == room and event["location_text"] is None
    assert event["occurrence"]["index"] == 0 and event["over"] is False and event["cancelled_at"] is None
    assert event["responses"] == {"going": [], "maybe": [], "no": []}

    listed = (await member.get(url(cid))).json()
    assert [e["id"] for e in listed["events"]] == [event["id"]] and listed["can_manage"] is False
    assert (await owner.get(url(cid))).json()["can_manage"] is True
    assert (await member.get(url(cid, f"/{event['id']}"))).json()["title"] == "Noite de jogos"

    # Creating posts a system line when the channel has an announce channel.
    chat = text_channel(server)
    await owner.patch(f"/channels/{cid}", {"announce_channel_id": chat, "confirm_wider_audience": True})
    await create(owner, cid, title="Churrasco", location_text="Casa da Ana")
    line = (await owner.get(f"/channels/{chat}/messages")).json()[-1]
    assert line["system"]["lines"] == ["criou o evento “Churrasco”"]


async def test_validation(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    server = await make_server(owner)
    sid = server["id"]
    cid = await events_channel(owner, sid)
    room = next(c["id"] for c in server["channels"] if c["type"] == "voice")
    other_server = await make_server(owner, name="Outro")
    other_room = next(c["id"] for c in other_server["channels"] if c["type"] == "voice")
    start = datetime.now(UTC) + timedelta(days=1)
    base = {"title": "X", "starts_at": iso(start), "ends_at": iso(start + timedelta(hours=1)), "timezone": ZONE}
    bad = [
        {**base, "title": "  "},
        {**base, "ends_at": iso(start)},
        {**base, "starts_at": "2026-12-01T20:00:00"},  # no time zone
        {**base, "timezone": "Mars/Olympus"},
        {**base, "ends_at": iso(start + timedelta(days=15))},
        {**base, "repeat": "weekly", "ends_at": iso(start + timedelta(days=8))},
        {**base, "starts_at": iso(start - timedelta(days=3)), "ends_at": iso(start - timedelta(days=2))},
        {**base, "location_channel_id": room, "location_text": "Bar"},
        {**base, "location_channel_id": other_room},
        {**base, "location_channel_id": text_channel(server)},
    ]
    for body in bad:
        assert (await owner.post(url(cid), body)).status_code == 422, body
    # A private room the creator can't see doesn't count either.
    member = await make_user(client, "member")
    code = (await owner.post(f"/servers/{sid}/invites", {})).json()["code"]
    await member.post(f"/invites/{code}/join")
    role = await create_role(owner, sid, "Eventos", Perm.MANAGE_EVENTS)
    await give(owner, sid, member, role)
    await owner.put(f"/channels/{room}/overrides/role/{sid}", {"deny": int(Perm.VIEW_CHANNEL)})
    assert (await member.post(url(cid), {**base, "location_channel_id": room})).status_code == 422
    assert (await member.post(url(cid), base)).status_code == 201


async def test_edit_cancel_delete(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    cid = await events_channel(owner, (await make_server(owner, member))["id"])
    event = await create(owner, cid, location_text="Bar")
    eid = event["id"]

    res = await owner.patch(url(cid, f"/{eid}"), {"title": "Noite de truco", "location_text": None, "repeat": "weekly"})
    assert res.status_code == 200, res.text
    edited = res.json()
    assert edited["title"] == "Noite de truco" and edited["location_text"] is None and edited["repeat"] == "weekly"
    assert (await owner.patch(url(cid, f"/{eid}"), {"ends_at": event["starts_at"]})).status_code == 422

    await answer(member, cid, eid, "going")
    res = await owner.post(url(cid, f"/{eid}/cancel"))
    assert res.status_code == 200 and res.json()["cancelled_at"] is not None
    assert (await owner.post(url(cid, f"/{eid}/cancel"))).status_code == 409
    # No more answers once it's cancelled.
    assert (await answer(member, cid, eid, "maybe")).status_code == 409

    assert (await owner.delete(url(cid, f"/{eid}"))).status_code == 204
    assert (await owner.get(url(cid))).json()["events"] == []
    assert (await owner.get(url(cid, f"/{eid}"))).status_code == 404


async def test_answers(client: AsyncClient) -> None:
    owner, ana, bia = [await make_user(client, n) for n in ("owner", "ana", "bia")]
    cid = await events_channel(owner, (await make_server(owner, ana, bia))["id"])
    eid = (await create(owner, cid))["id"]
    assert (await answer(ana, cid, eid, "going")).status_code == 200
    await answer(bia, cid, eid, "maybe")
    res = await answer(ana, cid, eid, "no")
    assert res.json()["responses"] == {"going": [], "maybe": [bia.id], "no": [ana.id]}
    res = await answer(bia, cid, eid, None)
    assert res.json()["responses"] == {"going": [], "maybe": [], "no": [ana.id]}
    assert (await answer(ana, cid, eid, "talvez")).status_code == 422

    # A one-off event that's over takes no answers.
    past = await create(owner, cid, in_hours=-3, hours=1)
    assert past["over"] is True
    assert (await answer(ana, cid, past["id"], "going")).status_code == 409


async def test_weekly_answers_start_over_each_week(client: AsyncClient) -> None:
    owner, ana = await make_user(client, "owner"), await make_user(client, "ana")
    cid = await events_channel(owner, (await make_server(owner, ana))["id"])
    # Started a week ago, weekly: the next one is the second week's.
    created = await create(owner, cid, in_hours=0.5, hours=1, repeat="weekly")
    async with SessionLocal() as session:
        await session.execute(
            update(Event)
            .where(Event.id == created["id"])
            .values(starts_at=Event.starts_at - timedelta(days=7), ends_at=Event.ends_at - timedelta(days=7))
        )
        await session.commit()
    event = (await ana.get(url(cid, f"/{created['id']}"))).json()
    assert event["occurrence"]["index"] == 1 and event["over"] is False
    res = await answer(ana, cid, event["id"], "going")
    assert res.json()["responses"]["going"] == [ana.id]

    start = datetime.now(UTC)
    items = (await ana.get("/users/me/agenda", params={"start": iso(start - timedelta(days=9)), "end": iso(start + timedelta(days=14))})).json()
    weeks = [(i["id"].split(":")[1], i["mine"]) for i in items if i["kind"] == "event"]
    assert weeks == [("0", False), ("1", True), ("2", False)]
    assert items[0]["item_id"] == event["id"] and items[0]["all_day"] is False and items[0]["addon_key"] == "events"


async def test_permissions(client: AsyncClient) -> None:
    owner, manager, member, outsider = [await make_user(client, n) for n in ("owner", "manager", "member", "outsider")]
    server = await make_server(owner, manager, member)
    sid = server["id"]
    cid = await events_channel(owner, sid)
    eid = (await create(owner, cid))["id"]
    body = {"title": "X", "starts_at": iso(datetime.now(UTC) + timedelta(days=1)), "ends_at": iso(datetime.now(UTC) + timedelta(days=1, hours=1)), "timezone": ZONE}

    # Members answer but don't manage.
    assert (await member.post(url(cid), body)).status_code == 403
    assert (await member.patch(url(cid, f"/{eid}"), {"title": "Y"})).status_code == 403
    assert (await member.post(url(cid, f"/{eid}/cancel"))).status_code == 403
    assert (await member.delete(url(cid, f"/{eid}"))).status_code == 403
    assert (await answer(member, cid, eid, "going")).status_code == 200
    # "Gerenciar eventos" is enough, and so is "Gerenciar addons".
    await give(owner, sid, manager, await create_role(owner, sid, "Eventos", Perm.MANAGE_EVENTS))
    assert (await manager.post(url(cid), body)).status_code == 201
    addons_role = await create_role(owner, sid, "Addons", Perm.MANAGE_ADDONS)
    await give(owner, sid, member, addons_role)
    assert (await member.post(url(cid), body)).status_code == 201
    # Outside the channel nothing exists.
    assert (await outsider.get(url(cid))).status_code == 404
    await owner.put(f"/channels/{cid}/overrides/role/{sid}", {"deny": int(Perm.VIEW_CHANNEL)})
    assert (await member.get(url(cid))).status_code == 404
    assert (await answer(member, cid, eid, "no")).status_code == 404


async def test_cover_and_cleanup(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    cid = await events_channel(owner, (await make_server(owner, member))["id"])
    eid = (await create(owner, cid))["id"]
    files = {"file": ("capa.png", PNG, "image/png")}
    assert (await client.put(f"/api{url(cid, f'/{eid}/cover')}", headers=member.headers, files=files)).status_code == 403
    res = await client.put(f"/api{url(cid, f'/{eid}/cover')}", headers=owner.headers, files=files)
    assert res.status_code == 200, res.text
    assert res.json()["cover"]
    cover = await member.get(url(cid, f"/{eid}/cover"))
    assert cover.status_code == 200 and cover.content == PNG
    bad = {"file": ("x.txt", b"hello", "text/plain")}
    assert (await client.put(f"/api{url(cid, f'/{eid}/cover')}", headers=owner.headers, files=bad)).status_code == 415
    assert (await owner.delete(url(cid, f"/{eid}/cover"))).json()["cover"] is None
    assert (await member.get(url(cid, f"/{eid}/cover"))).status_code == 404

    # Deleting the channel takes its events.
    assert (await owner.delete(f"/channels/{cid}")).status_code == 204
    async with SessionLocal() as session:
        assert await session.scalar(select(func.count()).select_from(Event)) == 0
