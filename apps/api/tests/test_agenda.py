"""The agenda: what has a date in the addons a user can see (the dated_items hook)."""

from typing import Any

from httpx import AsyncClient

from app.permissions import Perm
from tests.helpers import ApiUser, make_server, make_user
from tests.test_addons import add_card, board_channel

RANGE = {"start": "2026-11-01T00:00:00-03:00", "end": "2026-12-01T00:00:00-03:00"}


async def agenda(user: ApiUser, **params: Any) -> list[dict[str, Any]]:
    res = await user.get("/users/me/agenda", params={**RANGE, **params})
    assert res.status_code == 200, res.text
    return res.json()


async def due(user: ApiUser, cid: str, title: str, day: str, **fields: Any) -> dict[str, Any]:
    card = await add_card(user, cid, title)
    res = await user.patch(f"/addons/kanban/channels/{cid}/cards/{card['id']}", {"due_date": day, **fields})
    assert res.status_code == 200, res.text
    return res.json()


async def test_kanban_due_dates_in_the_agenda(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    server = await make_server(owner, member)
    cid = (await board_channel(owner, server["id"]))["id"]
    late = await due(owner, cid, "Entrega", "2026-11-27", assignee_id=member.id)
    await due(owner, cid, "Revisão", "2026-11-03")
    await due(owner, cid, "Ano que vem", "2027-02-01")
    await add_card(owner, cid, "Sem prazo")
    # Done cards are still listed, marked.
    board = (await owner.get(f"/addons/kanban/channels/{cid}")).json()
    done = next(c for c in board["columns"] if c["stage"] == "done")
    done_card = await due(owner, cid, "Feito", "2026-11-10")
    await owner.post(f"/addons/kanban/channels/{cid}/cards/{done_card['id']}/move", {"column_id": done["id"], "position": 0})

    items = await agenda(member)
    assert [i["title"] for i in items] == ["Revisão", "Feito", "Entrega"]
    first = items[2]
    assert first["kind"] == "card" and first["all_day"] is True and first["day"] == "2026-11-27"
    assert first["starts_at"] is None and first["item_id"] == late["id"] and first["mine"] is True
    assert first["addon_key"] == "kanban" and first["channel_id"] == cid and first["server_id"] == server["id"]
    assert [i["done"] for i in items] == [False, True, False]
    # Only mine.
    assert [i["title"] for i in await agenda(member, mine="true")] == ["Entrega"]
    # One server only.
    other = await make_server(member, name="Outro")
    assert await agenda(member, server_id=other["id"]) == []
    assert len(await agenda(member, server_id=server["id"])) == 3


async def test_agenda_respects_channel_access(client: AsyncClient) -> None:
    owner, member, outsider = [await make_user(client, n) for n in ("owner", "member", "outsider")]
    server = await make_server(owner, member)
    cid = (await board_channel(owner, server["id"]))["id"]
    await due(owner, cid, "Segredo", "2026-11-05")
    assert len(await agenda(member)) == 1
    assert await agenda(outsider) == []
    await owner.put(f"/channels/{cid}/overrides/role/{server['id']}", {"deny": int(Perm.VIEW_CHANNEL)})
    assert await agenda(member) == []
    assert len(await agenda(owner)) == 1


async def test_agenda_range(client: AsyncClient) -> None:
    user = await make_user(client, "user")
    for params in (
        {"start": "2026-11-02T00:00:00Z", "end": "2026-11-01T00:00:00Z"},
        {"start": "2026-11-01T00:00:00Z", "end": "2027-01-15T00:00:00Z"},
    ):
        assert (await user.get("/users/me/agenda", params=params)).status_code == 422
    assert (await user.get("/users/me/agenda", params={"start": "2026-11-01T00:00:00", "end": "2026-11-02T00:00:00"})).status_code == 200
