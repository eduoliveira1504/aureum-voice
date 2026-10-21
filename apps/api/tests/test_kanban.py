"""The Kanban board addon: columns, cards, moves, labels, history, permissions, live events."""

import uuid
from datetime import date
from typing import Any

from httpx import AsyncClient
from httpx_ws import aconnect_ws

from app.addons.registry import ADDONS
from app.db import SessionLocal
from app.permissions import Perm
from tests.helpers import ApiUser, make_server, make_user, text_channel, ws_client
from tests.test_addons import add_card, board_channel
from tests.test_ws import next_event, no_event, ws_url


def url(cid: str, path: str = "") -> str:
    return f"/addons/kanban/channels/{cid}{path}"


async def board(user: ApiUser, cid: str) -> dict[str, Any]:
    res = await user.get(url(cid))
    assert res.status_code == 200, res.text
    return res.json()


def titles(b: dict[str, Any], column_id: str) -> list[str]:
    cards = sorted((c for c in b["cards"] if c["column_id"] == column_id), key=lambda c: c["position"])
    return [c["title"] for c in cards]


async def test_a_new_board_starts_with_three_columns(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    sid = (await make_server(owner, member))["id"]
    cid = (await board_channel(owner, sid))["id"]
    b = await board(member, cid)
    assert [(c["name"], c["stage"]) for c in b["columns"]] == [("A fazer", "todo"), ("Fazendo", "doing"), ("Feito", "done")]
    assert b["cards"] == [] and b["labels"] == []
    assert b["can_edit"] is True and b["can_manage"] is False
    # Opening it again doesn't add more.
    assert len((await board(owner, cid))["columns"]) == 3


async def test_cards(client: AsyncClient) -> None:
    owner, member, outsider = [await make_user(client, n) for n in ("owner", "member", "outsider")]
    sid = (await make_server(owner, member, outsider))["id"]
    cid = (await board_channel(owner, sid))["id"]
    todo = (await board(owner, cid))["columns"][0]["id"]
    label = (await owner.post(url(cid, "/labels"), {"name": "Bug", "color": "red"})).json()

    res = await member.post(
        url(cid, "/cards"),
        {
            "column_id": todo,
            "title": "  Tela de login  ",
            "description": "Com e-mail e senha",
            "assignee_id": owner.id,
            "label_ids": [label["id"], label["id"]],
            "due_date": "2026-11-01",
        },
    )
    assert res.status_code == 201, res.text
    card = res.json()
    assert card["title"] == "Tela de login" and card["created_by"] == member.id and card["position"] == 0
    assert card["label_ids"] == [label["id"]] and card["due_date"] == "2026-11-01"
    assert (await add_card(member, cid, "Outro"))["position"] == 1

    # Only the fields sent change; null clears.
    res = await member.patch(url(cid, f"/cards/{card['id']}"), {"assignee_id": None, "due_date": None})
    assert res.status_code == 200
    changed = res.json()
    assert changed["assignee_id"] is None and changed["due_date"] is None and changed["title"] == "Tela de login"

    bad = [
        {"column_id": todo, "title": "   "},
        {"column_id": todo, "title": "x" * 201},
        {"column_id": todo, "title": "x", "label_ids": ["00000000-0000-0000-0000-000000000000"]},
        # The assignee must be able to see the board.
        {"column_id": todo, "title": "x", "assignee_id": (await make_user(client, "stranger")).id},
    ]
    for body in bad:
        assert (await member.post(url(cid, "/cards"), body)).status_code == 422, body
    assert (await member.post(url(cid, "/cards"), {"column_id": cid, "title": "x"})).status_code == 404

    assert (await member.delete(url(cid, f"/cards/{card['id']}"))).status_code == 204
    assert titles(await board(owner, cid), todo) == ["Outro"]
    assert (await member.patch(url(cid, f"/cards/{card['id']}"), {"title": "y"})).status_code == 404


async def test_moving_cards(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    sid = (await make_server(owner))["id"]
    cid = (await board_channel(owner, sid))["id"]
    todo, doing, _ = [c["id"] for c in (await board(owner, cid))["columns"]]
    a, b, c = [await add_card(owner, cid, t) for t in "ABC"]

    async def move(card: dict[str, Any], column: str, position: int) -> None:
        res = await owner.post(url(cid, f"/cards/{card['id']}/move"), {"column_id": column, "position": position})
        assert res.status_code == 200, res.text

    await move(c, todo, 0)  # reorder inside the column
    assert titles(await board(owner, cid), todo) == ["C", "A", "B"]
    await move(a, doing, 0)
    await move(b, doing, 99)  # past the end = last
    current = await board(owner, cid)
    assert titles(current, todo) == ["C"] and titles(current, doing) == ["A", "B"]
    await move(c, doing, 1)
    current = await board(owner, cid)
    assert titles(current, todo) == [] and titles(current, doing) == ["A", "C", "B"]
    # Positions stay 0..n-1.
    assert sorted(x["position"] for x in current["cards"]) == [0, 1, 2]


async def test_columns_and_labels_need_manage(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    sid = (await make_server(owner, member))["id"]
    cid = (await board_channel(owner, sid))["id"]
    todo, doing, done = [c["id"] for c in (await board(owner, cid))["columns"]]

    assert (await member.post(url(cid, "/columns"), {"name": "Revisão"})).status_code == 403
    assert (await member.post(url(cid, "/labels"), {"name": "Bug"})).status_code == 403
    assert (await member.patch(url(cid, f"/columns/{todo}"), {"name": "x"})).status_code == 403

    review = (await owner.post(url(cid, "/columns"), {"name": "Revisão", "stage": "doing"})).json()
    assert review["position"] == 3
    moved = (await owner.post(url(cid, f"/columns/{review['id']}/move"), {"position": 2})).json()
    assert [c["name"] for c in moved] == ["A fazer", "Fazendo", "Revisão", "Feito"]
    assert (await owner.patch(url(cid, f"/columns/{done}"), {"name": "Pronto"})).json()["name"] == "Pronto"
    assert (await owner.post(url(cid, "/columns"), {"name": "x", "stage": "later"})).status_code == 422

    # Only empty columns can go, and the last one stays.
    card = await add_card(member, cid)
    assert (await owner.delete(url(cid, f"/columns/{todo}"))).status_code == 409
    await member.delete(url(cid, f"/cards/{card['id']}"))
    for column in (todo, doing, review["id"]):
        assert (await owner.delete(url(cid, f"/columns/{column}"))).status_code == 204
    assert (await owner.delete(url(cid, f"/columns/{done}"))).status_code == 409

    # Labels: colors are token names; deleting one takes it off the cards.
    assert (await owner.post(url(cid, "/labels"), {"name": "x", "color": "#ff0000"})).status_code == 422
    label = (await owner.post(url(cid, "/labels"), {"name": "Bug", "color": "red"})).json()
    card = (await member.post(url(cid, "/cards"), {"column_id": done, "title": "t", "label_ids": [label["id"]]})).json()
    assert (await owner.patch(url(cid, f"/labels/{label['id']}"), {"color": "blue"})).json()["color"] == "blue"
    assert (await owner.delete(url(cid, f"/labels/{label['id']}"))).status_code == 204
    current = await board(owner, cid)
    assert current["labels"] == [] and current["cards"][0]["label_ids"] == []


async def test_permissions(client: AsyncClient) -> None:
    owner, member, outsider = [await make_user(client, n) for n in ("owner", "member", "outsider")]
    server = await make_server(owner, member)
    sid = server["id"]
    cid = (await board_channel(owner, sid))["id"]
    card = await add_card(owner, cid)

    # Outside the server, or in a channel of another kind, the board doesn't exist.
    assert (await outsider.get(url(cid))).status_code == 404
    assert (await owner.get(url(text_channel(server)))).status_code == 404

    # Editing cards follows SEND_MESSAGES in the channel...
    await owner.put(f"/channels/{cid}/overrides/member/{member.id}", {"deny": int(Perm.SEND_MESSAGES)})
    assert (await board(member, cid))["can_edit"] is False
    assert (await member.post(url(cid, "/cards"), {"column_id": card["column_id"], "title": "x"})).status_code == 403
    assert (await member.post(url(cid, f"/cards/{card['id']}/move"), {"column_id": card["column_id"], "position": 0})).status_code == 403
    assert (await member.delete(url(cid, f"/cards/{card['id']}"))).status_code == 403

    # ...and a hidden board is a 404, with no live events either.
    await owner.put(f"/channels/{cid}/overrides/member/{member.id}", {"deny": int(Perm.VIEW_CHANNEL)})
    assert (await member.get(url(cid))).status_code == 404
    assert (await member.get(url(cid, "/history"))).status_code == 404
    async with ws_client() as wsc, aconnect_ws(ws_url(member), wsc) as ws:
        await next_event(ws, "ready")
        await add_card(owner, cid, "segredo")
        await no_event(ws, "addon.kanban.card.created")

    # Another board's ids don't work here.
    other = (await board_channel(owner, sid))["id"]
    assert (await owner.patch(url(other, f"/cards/{card['id']}"), {"title": "x"})).status_code == 404


async def test_live_events(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    sid = (await make_server(owner, member))["id"]
    cid = (await board_channel(owner, sid))["id"]
    doing = (await board(owner, cid))["columns"][1]["id"]
    async with ws_client() as wsc, aconnect_ws(ws_url(owner), wsc) as ws:
        await next_event(ws, "ready")
        card = await add_card(member, cid, "Ao vivo")
        created = await next_event(ws, "addon.kanban.card.created")
        assert created["channel_id"] == cid and created["server_id"] == sid and created["id"] == card["id"]

        await member.patch(url(cid, f"/cards/{card['id']}"), {"title": "Ao vivo!"})
        assert (await next_event(ws, "addon.kanban.card.updated"))["title"] == "Ao vivo!"

        await member.post(url(cid, f"/cards/{card['id']}/move"), {"column_id": doing, "position": 0})
        moved = await next_event(ws, "addon.kanban.cards.moved")
        assert moved["cards"] == [{"id": card["id"], "column_id": doing, "position": 0}]

        await owner.post(url(cid, "/columns"), {"name": "Revisão"})
        assert (await next_event(ws, "addon.kanban.column.created"))["name"] == "Revisão"

        await member.delete(url(cid, f"/cards/{card['id']}"))
        assert (await next_event(ws, "addon.kanban.card.deleted")) == {"channel_id": cid, "server_id": sid, "id": card["id"]}


async def test_history(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    sid = (await make_server(owner, member))["id"]
    cid = (await board_channel(owner, sid))["id"]
    done = (await board(owner, cid))["columns"][2]["id"]
    card = await add_card(member, cid, "Login")
    other = await add_card(member, cid, "Outro")
    await member.patch(url(cid, f"/cards/{card['id']}"), {"description": "detalhes"})
    await member.patch(url(cid, f"/cards/{card['id']}"), {"description": "detalhes"})  # no change, no entry
    await owner.post(url(cid, f"/cards/{card['id']}/move"), {"column_id": done, "position": 0})
    await member.delete(url(cid, f"/cards/{card['id']}"))

    # A card's history outlives the card, and reads well without it.
    entries = (await owner.get(url(cid, "/history"), params={"card_id": card["id"]})).json()
    assert [(e["action"], e["actor_id"]) for e in entries] == [
        ("card.deleted", member.id),
        ("card.moved", owner.id),
        ("card.updated", member.id),
        ("card.created", member.id),
    ]
    assert entries[1]["data"] == {"title": "Login", "from": "A fazer", "to": "Feito"}
    assert entries[2]["data"] == {"title": "Login", "fields": ["description"]}

    everything = (await member.get(url(cid, "/history"))).json()
    assert len(everything) == 5 and other["id"] in [e["card_id"] for e in everything]
    page = (await member.get(url(cid, "/history"), params={"limit": 2, "before": everything[1]["id"]})).json()
    assert [e["id"] for e in page] == [e["id"] for e in everything[2:4]]


async def test_assigned_lists_unfinished_cards_of_the_given_boards(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    sid = (await make_server(owner, member))["id"]
    cid = (await board_channel(owner, sid))["id"]
    other = (await board_channel(owner, sid, "Outro"))["id"]
    todo, doing, done = [c["id"] for c in (await board(owner, cid))["columns"]]
    label = (await owner.post(url(cid, "/labels"), {"name": "Bug", "color": "red"})).json()

    async def card(board_id: str, column: str, title: str, assignee: str | None = member.id, **extra: Any) -> dict[str, Any]:
        body = {"column_id": column, "title": title, "assignee_id": assignee, **extra}
        res = await owner.post(url(board_id, "/cards"), body)
        assert res.status_code == 201, res.text
        return res.json()

    mine = await card(cid, todo, "Login", label_ids=[label["id"]], due_date="2026-11-01")
    await card(cid, doing, "Cadastro")
    await card(cid, done, "Pronto")  # finished: left out
    await card(cid, todo, "Do owner", owner.id)
    await card(cid, todo, "Sem ninguém", None)
    other_todo = (await board(owner, other))["columns"][0]["id"]
    await card(other, other_todo, "Em outro quadro")  # board not passed: left out

    async with SessionLocal() as session:
        items = await ADDONS["kanban"].assigned(session, [uuid.UUID(cid)], uuid.UUID(member.id))  # type: ignore[misc]
        assert await ADDONS["kanban"].assigned(session, [], uuid.UUID(member.id)) == []  # type: ignore[misc]
    by_title = {i.title: i for i in items}
    assert set(by_title) == {"Login", "Cadastro"}
    login = by_title["Login"]
    assert str(login.id) == mine["id"] and str(login.workspace_id) == cid
    assert login.status == "A fazer" and by_title["Cadastro"].status == "Fazendo"
    assert [(lb.name, lb.color) for lb in login.labels] == [("Bug", "red")]
    assert login.due_date == date(2026, 11, 1) and by_title["Cadastro"].due_date is None

    # Moving it to a done column takes it off the list.
    await owner.post(url(cid, f"/cards/{mine['id']}/move"), {"column_id": done, "position": 0})
    async with SessionLocal() as session:
        items = await ADDONS["kanban"].assigned(session, [uuid.UUID(cid)], uuid.UUID(member.id))  # type: ignore[misc]
    assert [i.title for i in items] == ["Cadastro"]
