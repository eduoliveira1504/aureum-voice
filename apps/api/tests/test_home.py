"""The Home hub (GET /users/me/home): mentions, unread DMs, tasks from addons and server
activity, always through the user's permissions; "Marcar tudo como lido"; and the voice events
the hub's live rooms are built from."""

from datetime import date, timedelta
from typing import Any

from httpx import AsyncClient
from httpx_ws import aconnect_ws

from app.permissions import Perm
from tests.helpers import ApiUser, make_server, make_user, text_channel, ws_client
from tests.test_addons import board_channel
from tests.test_dms import open_dm
from tests.test_friends import befriend
from tests.test_private_channels import create_private
from tests.test_reads import read_state, say
from tests.test_ws import next_event, no_event, ws_url

VIEW, CONNECT, READ_HISTORY = int(Perm.VIEW_CHANNEL), int(Perm.CONNECT), int(Perm.READ_HISTORY)


async def home(user: ApiUser) -> dict[str, Any]:
    res = await user.get("/users/me/home")
    assert res.status_code == 200, res.text
    return res.json()


async def deny(owner: ApiUser, channel_id: str, user: ApiUser, perms: int) -> None:
    res = await owner.put(f"/channels/{channel_id}/overrides/member/{user.id}", {"allow": 0, "deny": perms})
    assert res.status_code == 200, res.text


async def add_channel(owner: ApiUser, sid: str, name: str, type_: str = "text") -> str:
    res = await owner.post(f"/servers/{sid}/channels", {"name": name, "type": type_})
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def test_empty(client: AsyncClient) -> None:
    user = await make_user(client, "fresh")
    assert await home(user) == {"mentions": [], "dms": [], "tasks": [], "tasks_total": 0, "servers": []}
    assert (await user.get("/users/me/tasks")).json() == []
    assert (await user.post("/users/me/home/read")).json() == []


async def test_mentions_match_the_counters(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await make_user(client, "anabel")
    server = await make_server(ana, bia)
    sid, cid = server["id"], text_channel(server)

    first = await say(bia, cid, "@ana olha isso")
    await say(bia, cid, "isso é pra @anabel, não pra ana")  # another name that starts the same
    await say(bia, cid, "email ana@ana.com não é menção")
    last = await say(bia, cid, "de novo @ANA, e @bia")  # case doesn't matter
    await say(ana, cid, "@ana eu mesma")  # own messages never count

    mentions = (await home(ana))["mentions"]
    assert [m["message"]["id"] for m in mentions] == [last["id"], first["id"]]
    assert mentions[0]["server_id"] == sid and mentions[0]["message"]["author"]["id"] == bia.id
    # The list and the badge agree.
    assert (await read_state(ana, server, cid))["mention_count"] == len(mentions)

    await ana.post(f"/channels/{cid}/read")
    assert (await home(ana))["mentions"] == []


async def test_mentions_need_read_history_and_access(client: AsyncClient) -> None:
    owner, ana, bia = [await make_user(client, n) for n in ("owner", "ana", "bia")]
    server = await make_server(owner, ana, bia)
    sid = server["id"]
    public, history, lost = text_channel(server), await add_channel(owner, sid, "historia"), await add_channel(owner, sid, "perdido")
    for cid in (public, history, lost):
        await say(bia, cid, f"@ana em {cid}")
    await deny(owner, history, ana, READ_HISTORY)
    await deny(owner, lost, ana, VIEW)
    assert [m["message"]["channel_id"] for m in (await home(ana))["mentions"]] == [public]


async def test_unread_dms(client: AsyncClient) -> None:
    ana, bia, caio, duda = [await make_user(client, n) for n in ("ana", "bia", "caio", "duda")]
    for other in (bia, caio, duda):
        await befriend(ana, other)
    with_bia, with_caio, with_duda = await open_dm(ana, bia), await open_dm(ana, caio), await open_dm(ana, duda)

    await say(bia, with_bia["id"], "oi")
    newest = await say(bia, with_bia["id"], "tá aí?")
    reply = await say(ana, with_bia["id"], "já vou")  # replying doesn't read the conversation
    await say(caio, with_caio["id"], "silenciado")
    await ana.patch("/users/me/settings", {"muted_places": [with_caio["id"]]})
    await say(duda, with_duda["id"], "fechada")  # closed afterwards: out of the list
    assert (await ana.delete(f"/dms/{with_duda['id']}")).status_code == 204

    dms = (await home(ana))["dms"]
    assert [(d["channel_id"], d["unread_count"], d["message"]["id"]) for d in dms] == [(with_bia["id"], 2, newest["id"])]
    assert [(d["unread_count"], d["message"]["id"]) for d in (await home(bia))["dms"]] == [(1, reply["id"])]


async def test_tasks_respect_access_and_order(client: AsyncClient) -> None:
    owner, ana = await make_user(client, "owner"), await make_user(client, "ana")
    sid = (await make_server(owner, ana, name="Squad"))["id"]
    board = await board_channel(owner, sid, "Sprint")
    cid = board["id"]
    hidden = (await create_private(owner, sid, "addon", addon_key="kanban", allowed_members=[ana.id]))["id"]
    todo = (await owner.get(f"/addons/kanban/channels/{cid}")).json()["columns"][0]["id"]
    hidden_todo = (await owner.get(f"/addons/kanban/channels/{hidden}")).json()["columns"][0]["id"]
    today = date.today()

    async def card(title: str, due: date | None, channel: str = cid, column: str = todo) -> None:
        body = {"column_id": column, "title": title, "assignee_id": ana.id, "due_date": due.isoformat() if due else None}
        assert (await owner.post(f"/addons/kanban/channels/{channel}/cards", body)).status_code == 201

    await card("Sem prazo antigo", None)
    await card("Daqui a 5 dias", today + timedelta(days=5))
    await card("Atrasado", today - timedelta(days=2))
    await card("Amanhã", today + timedelta(days=1))
    await card("Sem prazo novo", None)
    for i in range(3):
        await card(f"Depois {i}", today + timedelta(days=10 + i))
    await card("No quadro privado", today, hidden, hidden_todo)

    got = await home(ana)
    assert got["tasks_total"] == 9
    assert [t["title"] for t in got["tasks"]] == ["Atrasado", "No quadro privado", "Amanhã", "Daqui a 5 dias", "Depois 0", "Depois 1"]
    first = got["tasks"][0]
    assert (first["server_id"], first["server_name"], first["channel_id"], first["channel_name"]) == (sid, "Squad", cid, "Sprint")
    assert first["addon_key"] == "kanban" and first["status"] == "A fazer"
    every = (await ana.get("/users/me/tasks")).json()
    assert [t["title"] for t in every][-2:] == ["Sem prazo novo", "Sem prazo antigo"] and len(every) == 9

    # Losing access to a board takes its cards off the hub, even though they're still assigned.
    await deny(owner, hidden, ana, VIEW)
    assert "No quadro privado" not in [t["title"] for t in (await ana.get("/users/me/tasks")).json()]
    assert (await home(owner))["tasks"] == []


async def test_server_activity_counts_visible_channels_only(client: AsyncClient) -> None:
    owner, ana = await make_user(client, "owner"), await make_user(client, "ana")
    quiet = await make_server(owner, ana, name="Quieto")
    busy = await make_server(owner, ana, name="Ativo")
    said = await say(owner, text_channel(busy), "oi")
    secret = (await create_private(owner, quiet["id"]))["id"]
    await say(owner, secret, "segredo")

    activity = {s["id"]: s["last_activity_at"] for s in (await home(ana))["servers"]}
    assert activity == {quiet["id"]: None, busy["id"]: said["created_at"]}
    assert all(s["last_activity_at"] for s in (await home(owner))["servers"])


async def test_mark_all_read(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia)
    sid, mentioned = server["id"], text_channel(server)
    chatter = await add_channel(ana, sid, "papo")
    await befriend(ana, bia)
    dm = await open_dm(ana, bia)
    await say(bia, mentioned, "@ana vem")
    await say(bia, chatter, "sem menção")
    await say(bia, dm["id"], "oi")

    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as ws:
        await next_event(ws, "ready")
        res = await ana.post("/users/me/home/read")
        assert res.status_code == 200
        assert {s["channel_id"] for s in res.json()} == {mentioned, dm["id"]}
        events = {(e["channel_id"], e["server_id"]) for e in [await next_event(ws, "read.updated") for _ in range(2)]}
        assert events == {(mentioned, sid), (dm["id"], None)}

    got = await home(ana)
    assert got["mentions"] == [] and got["dms"] == []
    # Only what the section shows is marked: other unread channels keep their badge.
    assert (await read_state(ana, server, chatter))["unread_count"] == 1


async def test_voice_state_of_a_private_room_never_reaches_outsiders(client: AsyncClient) -> None:
    """The hub's "Ao vivo agora" is built from voice.state events and ServerDetail.voice_states,
    so a room the user can't see must never show up in either."""
    owner, guest, outsider = [await make_user(client, n) for n in ("owner", "guest", "outsider")]
    server = await make_server(owner, guest, outsider)
    sid = server["id"]
    public = next(c["id"] for c in server["channels"] if c["type"] == "voice")
    private = (await create_private(owner, sid, "voice", allowed_members=[guest.id]))["id"]

    async with ws_client() as wsc, aconnect_ws(ws_url(outsider), wsc) as out, aconnect_ws(ws_url(guest), wsc) as gws:
        await next_event(out, "ready")
        await next_event(gws, "ready")
        await gws.send_json({"type": "voice.update", "data": {"channel_id": public}})
        assert (await next_event(out, "voice.state"))["state"]["channel_id"] == public
        # Moving into the private room: the outsider only sees them leave the public one.
        await gws.send_json({"type": "voice.update", "data": {"channel_id": private}})
        assert (await next_event(out, "voice.state"))["state"] is None
        # Changes inside the private room don't reach them either.
        await gws.send_json({"type": "voice.update", "data": {"channel_id": private, "muted": True}})
        await next_event(gws, "voice.state")
        await no_event(out, "voice.state")
        assert [v for v in (await outsider.get(f"/servers/{sid}")).json()["voice_states"]] == []

        # Someone who loses sight of the room stops hearing about it, too.
        await owner.put(f"/channels/{private}/overrides/member/{outsider.id}", {"allow": VIEW, "deny": CONNECT})
        await gws.send_json({"type": "voice.update", "data": {"channel_id": private, "muted": False}})
        # Seeing without CONNECT still shows who's there (the hub hides the card: it can't be joined).
        assert (await next_event(out, "voice.state"))["state"]["channel_id"] == private
        await owner.delete(f"/channels/{private}/overrides/member/{outsider.id}")
        await gws.send_json({"type": "voice.update", "data": {"channel_id": private, "muted": True}})
        await no_event(out, "voice.state")
