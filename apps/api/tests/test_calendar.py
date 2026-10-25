"""The calendar addon: it gathers the server's dated items (events, Kanban due dates) through the
dated_items hook, each only from channels the user can see."""

from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient

from app.permissions import Perm
from tests.helpers import ApiUser, make_server, make_user
from tests.test_addons import board_channel
from tests.test_agenda import due
from tests.test_events import answer, create, events_channel


async def calendar_channel(owner: ApiUser, server_id: str) -> str:
    res = await owner.post(f"/servers/{server_id}/channels", {"name": "Calendário", "type": "addon", "addon_key": "calendar"})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def month() -> dict[str, str]:
    now = datetime.now(UTC)
    return {"start": (now - timedelta(days=5)).isoformat(), "end": (now + timedelta(days=40)).isoformat()}


async def calendar(user: ApiUser, cid: str, **params: Any) -> dict[str, Any]:
    res = await user.get(f"/addons/calendar/channels/{cid}/items", params=params or month())
    assert res.status_code == 200, res.text
    return res.json()


async def test_gathers_events_and_due_dates(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    server = await make_server(owner, member)
    sid = server["id"]
    cal = await calendar_channel(owner, sid)
    board = (await board_channel(owner, sid, "Sprint"))["id"]
    other_board = (await board_channel(owner, sid, "Ideias"))["id"]
    events = await events_channel(owner, sid)
    in_ten_days = (datetime.now(UTC) + timedelta(days=10)).date().isoformat()
    card = await due(owner, board, "Entrega", in_ten_days, assignee_id=member.id)
    await due(owner, other_board, "Pesquisa", in_ten_days)
    event = await create(owner, events, title="Noite de jogos")
    await answer(member, events, event["id"], "maybe")
    # Another server's things never show up.
    other_server = await make_server(member, name="Outro")
    await due(member, (await board_channel(member, other_server["id"]))["id"], "De fora", in_ten_days)

    data = await calendar(member, cal)
    assert sorted(i["title"] for i in data["items"]) == ["Entrega", "Noite de jogos", "Pesquisa"]
    by_title = {i["title"]: i for i in data["items"]}
    assert by_title["Entrega"]["item_id"] == card["id"] and by_title["Entrega"]["channel_id"] == board
    assert by_title["Entrega"]["mine"] is True and by_title["Pesquisa"]["mine"] is False
    assert by_title["Noite de jogos"]["mine"] is True and by_title["Noite de jogos"]["kind"] == "event"
    assert [(s["addon_key"], s["channel_name"]) for s in data["sources"]] == [("events", "Eventos"), ("kanban", "Ideias"), ("kanban", "Sprint")]

    # A change of due date shows on the next read.
    await owner.patch(f"/addons/kanban/channels/{board}/cards/{card['id']}", {"due_date": None})
    assert "Entrega" not in {i["title"] for i in (await calendar(member, cal))["items"]}


async def test_items_follow_each_channels_access(client: AsyncClient) -> None:
    owner, member, outsider = [await make_user(client, n) for n in ("owner", "member", "outsider")]
    server = await make_server(owner, member)
    sid = server["id"]
    cal = await calendar_channel(owner, sid)
    board = (await board_channel(owner, sid, "Diretoria"))["id"]
    await due(owner, board, "Segredo", (datetime.now(UTC) + timedelta(days=3)).date().isoformat())
    await owner.put(f"/channels/{board}/overrides/role/{sid}", {"deny": int(Perm.VIEW_CHANNEL)})

    assert [i["title"] for i in (await calendar(owner, cal))["items"]] == ["Segredo"]
    seen = await calendar(member, cal)
    assert seen["items"] == [] and seen["sources"] == []
    # Nor through the agenda, nor without being in the server.
    start = datetime.now(UTC)
    params = {"start": start.isoformat(), "end": (start + timedelta(days=30)).isoformat()}
    assert (await member.get("/users/me/agenda", params=params)).json() == []
    assert (await outsider.get(f"/addons/calendar/channels/{cal}/items", params=month())).status_code == 404
    # Without seeing the calendar itself, nothing either.
    await owner.put(f"/channels/{cal}/overrides/role/{sid}", {"deny": int(Perm.VIEW_CHANNEL)})
    assert (await member.get(f"/addons/calendar/channels/{cal}/items", params=month())).status_code == 404


async def test_range(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    cal = await calendar_channel(owner, (await make_server(owner))["id"])
    for params in (
        {"start": "2026-11-02T00:00:00Z", "end": "2026-11-01T00:00:00Z"},
        {"start": "2026-11-01T00:00:00Z", "end": "2027-01-15T00:00:00Z"},
    ):
        assert (await owner.get(f"/addons/calendar/channels/{cal}/items", params=params)).status_code == 422
