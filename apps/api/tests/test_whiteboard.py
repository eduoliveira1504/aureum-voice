"""The whiteboard addon: boards, scenes and sync, images, versions, permissions, live events."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient
from httpx_ws import aconnect_ws
from sqlalchemy import func, select

from app.addons.whiteboard.models import WhiteboardBoard
from app.db import SessionLocal
from app.permissions import DEFAULT_EVERYONE, Perm
from tests.helpers import ApiUser, make_server, make_user, text_channel, ws_client
from tests.test_profile import GIF, PNG
from tests.test_ws import next_event, no_event, ws_url


async def whiteboard_channel(owner: ApiUser, server_id: str, name: str = "Quadro branco") -> str:
    res = await owner.post(f"/servers/{server_id}/channels", {"name": name, "type": "addon", "addon_key": "whiteboard"})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def url(cid: str, path: str = "") -> str:
    return f"/addons/whiteboard/channels/{cid}{path}"


async def new_board(user: ApiUser, cid: str, name: str = "Ideias", **extra: Any) -> dict[str, Any]:
    res = await user.post(url(cid, "/boards"), {"name": name, **extra})
    assert res.status_code == 201, res.text
    return res.json()


async def board_rows() -> int:
    async with SessionLocal() as session:
        return await session.scalar(select(func.count()).select_from(WhiteboardBoard)) or 0


async def test_boards(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    sid = (await make_server(owner, member))["id"]
    cid = await whiteboard_channel(owner, sid)

    listed = (await member.get(url(cid, "/boards"))).json()
    assert listed == {"boards": [], "can_edit": True}

    first = await new_board(member, cid, "  Ideias  ")
    assert (first["name"], first["background"], first["version"], first["thumbnail"]) == ("Ideias", "plain", 0, None)
    assert first["created_by"] == member.id and first["updated_by"] == member.id
    second = await new_board(owner, cid, "Mapa", background="grid")
    # Last edited first.
    assert [b["name"] for b in (await member.get(url(cid, "/boards"))).json()["boards"]] == ["Mapa", "Ideias"]

    scene = (await owner.get(url(cid, f"/boards/{first['id']}"))).json()
    assert scene["elements"] == [] and scene["can_edit"] is True

    renamed = await owner.patch(url(cid, f"/boards/{first['id']}"), {"name": "Ideias boas", "background": "grid"})
    assert renamed.status_code == 200
    assert (renamed.json()["name"], renamed.json()["background"], renamed.json()["updated_by"]) == ("Ideias boas", "grid", owner.id)
    assert (await owner.patch(url(cid, f"/boards/{first['id']}"), {"name": "  "})).status_code == 422

    archived = (await member.patch(url(cid, f"/boards/{second['id']}"), {"archived": True})).json()
    assert archived["archived_at"] is not None
    # Still listed (the app shows archived ones apart) and still opens.
    assert len((await member.get(url(cid, "/boards"))).json()["boards"]) == 2
    assert (await member.get(url(cid, f"/boards/{second['id']}"))).status_code == 200
    back = (await member.patch(url(cid, f"/boards/{second['id']}"), {"archived": False})).json()
    assert back["archived_at"] is None


async def test_duplicate(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    sid = (await make_server(owner))["id"]
    cid = await whiteboard_channel(owner, sid)
    board = await new_board(owner, cid, "Rascunho", background="grid")

    res = await owner.post(url(cid, f"/boards/{board['id']}/duplicate"))
    assert res.status_code == 201, res.text
    copy = res.json()
    assert copy["id"] != board["id"]
    assert (copy["name"], copy["background"]) == ("Rascunho (cópia)", "grid")


async def test_permissions(client: AsyncClient) -> None:
    owner, viewer, outsider = [await make_user(client, n) for n in ("owner", "viewer", "outsider")]
    sid = (await make_server(owner, viewer))["id"]
    await make_server(outsider)
    cid = await whiteboard_channel(owner, sid)
    board = await new_board(owner, cid)

    # Without EDIT_WHITEBOARD on @everyone, members only look.
    await owner.patch(f"/roles/{sid}", {"permissions": int(DEFAULT_EVERYONE & ~Perm.EDIT_WHITEBOARD)})
    assert (await viewer.get(url(cid, "/boards"))).json()["can_edit"] is False
    assert (await viewer.get(url(cid, f"/boards/{board['id']}"))).json()["can_edit"] is False
    assert (await viewer.post(url(cid, "/boards"), {"name": "x"})).status_code == 403
    assert (await viewer.patch(url(cid, f"/boards/{board['id']}"), {"name": "x"})).status_code == 403
    assert (await viewer.post(url(cid, f"/boards/{board['id']}/duplicate"))).status_code == 403

    # A channel override gives it back, in that channel only.
    await owner.put(f"/channels/{cid}/overrides/member/{viewer.id}", {"allow": int(Perm.EDIT_WHITEBOARD)})
    assert (await viewer.post(url(cid, "/boards"), {"name": "x"})).status_code == 201

    # Outside the server it's as if the channel didn't exist.
    assert (await outsider.get(url(cid, "/boards"))).status_code == 404
    assert (await outsider.get(url(cid, f"/boards/{board['id']}"))).status_code == 404

    # A board of another channel isn't reachable through this one.
    other = await whiteboard_channel(owner, sid, "Outro")
    assert (await owner.get(url(other, f"/boards/{board['id']}"))).status_code == 404


async def test_board_events(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    sid = (await make_server(owner, member))["id"]
    cid = await whiteboard_channel(owner, sid)

    async with ws_client() as wsc, aconnect_ws(ws_url(member), wsc) as ws:
        await next_event(ws, "ready")
        board = await new_board(owner, cid, "Ao vivo")
        created = await next_event(ws, "addon.whiteboard.board.created")
        assert created["channel_id"] == cid and created["id"] == board["id"] and created["name"] == "Ao vivo"
        await owner.patch(url(cid, f"/boards/{board['id']}"), {"name": "Novo nome"})
        updated = await next_event(ws, "addon.whiteboard.board.updated")
        assert updated["name"] == "Novo nome"


async def test_deleting_the_channel_cleans_up(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    sid = (await make_server(owner))["id"]
    cid = await whiteboard_channel(owner, sid)
    await new_board(owner, cid)
    before = await board_rows()
    assert (await owner.delete(f"/channels/{cid}")).status_code == 204
    assert await board_rows() == before - 1


def element(id_: str, version: int = 1, nonce: int = 100, **extra: Any) -> dict[str, Any]:
    return {"id": id_, "type": "rectangle", "version": version, "versionNonce": nonce, "x": 0, "y": 0, **extra}


async def save(user: ApiUser, cid: str, board_id: str, *elements: dict[str, Any]) -> Any:
    return await user.put(url(cid, f"/boards/{board_id}/elements"), {"elements": list(elements), "origin": "test"})


async def scene(user: ApiUser, cid: str, board_id: str) -> dict[str, dict[str, Any]]:
    return {e["id"]: e for e in (await user.get(url(cid, f"/boards/{board_id}"))).json()["elements"]}


async def test_two_people_drawing_at_once_keep_both(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    sid = (await make_server(ana, bia))["id"]
    cid = await whiteboard_channel(ana, sid)
    bid = (await new_board(ana, cid))["id"]

    # Each draws her own stroke, saved at the same time: both stay.
    assert (await save(ana, cid, bid, element("a1"))).json() == {"version": 1, "accepted": 1}
    assert (await save(bia, cid, bid, element("b1"))).json() == {"version": 2, "accepted": 1}
    assert set(await scene(ana, cid, bid)) == {"a1", "b1"}

    # Both move the same element: the higher version wins, whatever arrives last.
    await save(ana, cid, bid, element("a1", 3, x=30))
    assert (await save(bia, cid, bid, element("a1", 2, x=20))).json()["accepted"] == 0
    assert (await scene(bia, cid, bid))["a1"]["x"] == 30
    # Same version: the lower nonce, as in Excalidraw itself.
    await save(bia, cid, bid, element("b1", 2, nonce=50, x=1))
    await save(ana, cid, bid, element("b1", 2, nonce=10, x=2))
    await save(bia, cid, bid, element("b1", 2, nonce=90, x=3))
    assert (await scene(ana, cid, bid))["b1"]["x"] == 2

    # Deleting is an edit too: the tombstone stays, so an old copy can't bring it back.
    await save(ana, cid, bid, element("b1", 5, isDeleted=True))
    await save(bia, cid, bid, element("b1", 4))
    assert (await scene(bia, cid, bid))["b1"]["isDeleted"] is True

    # Unknown fields are kept as they are (Excalidraw's own), and the board shows who edited.
    await save(bia, cid, bid, element("t1", type="text", text="Oi", fontSize=20))
    saved = await scene(ana, cid, bid)
    assert (saved["t1"]["text"], saved["t1"]["fontSize"]) == ("Oi", 20)
    summary = (await ana.get(url(cid, "/boards"))).json()["boards"][0]
    assert summary["updated_by"] == bia.id and summary["version"] == 7


async def test_scene_validation_and_limits(client: AsyncClient) -> None:
    owner, viewer = await make_user(client, "owner"), await make_user(client, "viewer")
    sid = (await make_server(owner, viewer))["id"]
    cid = await whiteboard_channel(owner, sid)
    bid = (await new_board(owner, cid))["id"]

    # Embeds load other sites and AI frames aren't part of Aureum.
    for kind in ("embeddable", "iframe", "magicframe"):
        assert (await save(owner, cid, bid, element("x", type=kind))).status_code == 422
    assert (await save(owner, cid, bid, element("bad id!"))).status_code == 422
    assert (await save(owner, cid, bid, {"id": "x", "type": "line"})).status_code == 422  # no version

    # Up to 5 MB of scene.
    big = element("big", type="freedraw", points=[[i, i] for i in range(400_000)])
    assert (await save(owner, cid, bid, big)).status_code == 413
    assert await scene(owner, cid, bid) == {}

    # Only with EDIT_WHITEBOARD, also through the API.
    await owner.patch(f"/roles/{sid}", {"permissions": int(DEFAULT_EVERYONE & ~Perm.EDIT_WHITEBOARD)})
    assert (await save(viewer, cid, bid, element("v1"))).status_code == 403
    assert await scene(owner, cid, bid) == {}


async def test_saves_go_live_to_the_list(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    sid = (await make_server(owner, member))["id"]
    cid = await whiteboard_channel(owner, sid)
    bid = (await new_board(owner, cid))["id"]

    async with ws_client() as wsc, aconnect_ws(ws_url(member), wsc) as ws:
        await next_event(ws, "ready")
        await save(owner, cid, bid, element("a1"))
        updated = await next_event(ws, "addon.whiteboard.board.updated")
        assert updated["id"] == bid and updated["version"] == 1 and updated["updated_by"] == owner.id


async def test_images(client: AsyncClient) -> None:
    owner, viewer, outsider = [await make_user(client, n) for n in ("owner", "viewer", "outsider")]
    sid = (await make_server(owner, viewer))["id"]
    cid = await whiteboard_channel(owner, sid)

    async def upload(user: ApiUser, file_id: str, data: bytes) -> Any:
        return await user.client.post(
            f"/api{url(cid, '/files')}",
            headers=user.headers,
            data={"file_id": file_id},
            files={"file": ("x.png", data, "image/png")},
        )

    res = await upload(owner, "f1", PNG)
    assert res.status_code == 201 and res.json() == {"file_id": "f1", "content_type": "image/png"}
    # Same id again: kept as it was (the id is a hash of the content).
    assert (await upload(owner, "f1", GIF)).json()["content_type"] == "image/png"
    assert (await upload(owner, "f2", b"not an image")).status_code == 415
    assert (await upload(owner, "f3", PNG + b"\x00" * (10 * 1024 * 1024))).status_code == 413

    got = await viewer.get(url(cid, "/files/f1"))
    assert got.status_code == 200 and got.content == PNG and got.headers["content-type"] == "image/png"
    assert (await viewer.get(url(cid, "/files/nope"))).status_code == 404
    assert (await outsider.get(url(cid, "/files/f1"))).status_code == 404

    await owner.patch(f"/roles/{sid}", {"permissions": int(DEFAULT_EVERYONE & ~Perm.EDIT_WHITEBOARD)})
    assert (await upload(viewer, "f4", PNG)).status_code == 403


async def test_thumbnail(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    sid = (await make_server(owner))["id"]
    cid = await whiteboard_channel(owner, sid)
    bid = (await new_board(owner, cid))["id"]
    assert (await owner.get(url(cid, f"/boards/{bid}/thumbnail"))).status_code == 404

    async def put(data: bytes) -> Any:
        return await owner.client.put(
            f"/api{url(cid, f'/boards/{bid}/thumbnail')}", headers=owner.headers, files={"file": ("t.png", data, "image/png")}
        )

    first = (await put(PNG)).json()["thumbnail"]
    second = (await put(PNG + b"\x01")).json()["thumbnail"]
    assert first and second and first != second
    got = await owner.get(url(cid, f"/boards/{bid}/thumbnail"))
    assert got.status_code == 200 and got.content == PNG + b"\x01"
    assert (await put(PNG + b"\x00" * 600_000)).status_code == 413


async def age_versions(board_id: str) -> None:
    """Makes the last version 11 minutes old, so the next edit keeps another one."""
    async with SessionLocal() as session:
        board = await session.get(WhiteboardBoard, uuid.UUID(board_id))
        assert board is not None
        board.snapshot_at = datetime.now(UTC) - timedelta(minutes=11)
        await session.commit()


async def test_versions_and_restore(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    sid = (await make_server(owner, member))["id"]
    cid = await whiteboard_channel(owner, sid)
    bid = (await new_board(owner, cid))["id"]

    # The first stroke on an empty board keeps nothing; the next edit after a while keeps the
    # board as it was before it.
    await save(owner, cid, bid, element("a1", x=1))
    assert (await owner.get(url(cid, f"/boards/{bid}/versions"))).json() == []
    await save(owner, cid, bid, element("a2"))
    first = (await owner.get(url(cid, f"/boards/{bid}/versions"))).json()
    assert len(first) == 1 and first[0]["author_id"] == owner.id
    # Within 10 minutes of it, edits don't keep more.
    await save(member, cid, bid, element("a3"))
    assert len((await owner.get(url(cid, f"/boards/{bid}/versions"))).json()) == 1
    await age_versions(bid)
    await save(member, cid, bid, element("a1", 2, x=99))
    versions = (await owner.get(url(cid, f"/boards/{bid}/versions"))).json()
    assert len(versions) == 2 and versions[0]["author_id"] == member.id

    preview = (await member.get(url(cid, f"/boards/{bid}/versions/{first[0]['id']}"))).json()
    assert [e["id"] for e in preview["elements"]] == ["a1"]

    async with ws_client() as wsc, aconnect_ws(ws_url(member), wsc) as ws:
        await next_event(ws, "ready")
        res = await member.post(url(cid, f"/boards/{bid}/versions/{first[0]['id']}/restore"))
        assert res.status_code == 200, res.text
        await next_event(ws, "addon.whiteboard.board.updated")

    restored = await scene(owner, cid, bid)
    assert {k for k, e in restored.items() if not e.get("isDeleted")} == {"a1"}
    # Above every version the apps have, so theirs give way.
    assert restored["a1"]["x"] == 1 and restored["a1"]["version"] == 3
    assert restored["a2"]["isDeleted"] is True and restored["a2"]["version"] == 2
    # The board from before restoring is a version too: restoring can be undone.
    assert len((await owner.get(url(cid, f"/boards/{bid}/versions"))).json()) == 3

    # Only for who can edit; versions of another board aren't reachable.
    other = (await new_board(owner, cid))["id"]
    assert (await owner.get(url(cid, f"/boards/{other}/versions/{first[0]['id']}"))).status_code == 404
    await owner.patch(f"/roles/{sid}", {"permissions": int(DEFAULT_EVERYONE & ~Perm.EDIT_WHITEBOARD)})
    assert (await member.post(url(cid, f"/boards/{bid}/versions/{first[0]['id']}/restore"))).status_code == 403


async def test_only_the_last_versions_are_kept(client: AsyncClient, monkeypatch: Any) -> None:
    from app.addons.whiteboard import router as whiteboard

    monkeypatch.setattr(whiteboard, "MAX_SNAPSHOTS", 3)
    owner = await make_user(client, "owner")
    sid = (await make_server(owner))["id"]
    cid = await whiteboard_channel(owner, sid)
    bid = (await new_board(owner, cid))["id"]
    await save(owner, cid, bid, element("a", 1))
    for v in range(2, 8):
        await age_versions(bid)
        await save(owner, cid, bid, element("a", v))
    versions = (await owner.get(url(cid, f"/boards/{bid}/versions"))).json()
    assert len(versions) == 3


async def send(ws: Any, name: str, **data: Any) -> None:
    await ws.send_json({"type": f"addon.whiteboard.{name}", "data": data})


async def test_live_drawing_and_cursors(client: AsyncClient) -> None:
    ana, bia, leo = [await make_user(client, n) for n in ("ana", "bia", "leo")]
    sid = (await make_server(ana, bia, leo))["id"]
    cid = await whiteboard_channel(ana, sid)
    bid = (await new_board(ana, cid))["id"]
    other = (await new_board(ana, cid, "Outro"))["id"]
    # Leo only looks.
    await ana.put(f"/channels/{cid}/overrides/member/{leo.id}", {"deny": int(Perm.EDIT_WHITEBOARD)})

    async with (
        ws_client() as wsc,
        aconnect_ws(ws_url(ana), wsc) as a,
        aconnect_ws(ws_url(bia), wsc) as b,
        aconnect_ws(ws_url(leo), wsc) as c,
    ):
        for ws in (a, b, c):
            await next_event(ws, "ready")
        await send(a, "join", channel_id=cid, board_id=bid, origin="A")
        # Each connection's messages are handled on their own: without a pause, Bia's join can
        # land before Ana is in the room, and Ana never hears of it.
        await asyncio.sleep(0.3)
        await send(b, "join", channel_id=cid, board_id=bid, origin="B")
        joined = await next_event(a, "addon.whiteboard.peer.joined")
        assert (joined["user_id"], joined["origin"], joined["board_id"]) == (bia.id, "B", bid)
        await send(c, "join", channel_id=cid, board_id=other, origin="C")

        # A stroke while it's drawn: to the others on the board only.
        await send(a, "update", board_id=bid, elements=[element("s1", type="freedraw")], origin="A")
        live = await next_event(b, "addon.whiteboard.live")
        assert (live["user_id"], live["origin"], [e["id"] for e in live["elements"]]) == (ana.id, "A", ["s1"])
        await no_event(c, "addon.whiteboard.live")

        # Cursors, with what the sender sees (for following them).
        viewport = {"x": 10, "y": 20, "width": 800, "height": 600, "zoom": 1.5}
        await send(b, "pointer", board_id=bid, x=1.5, y=2, button="down", viewport=viewport, selected=["s1"], origin="B")
        cursor = await next_event(a, "addon.whiteboard.pointer")
        assert (cursor["user_id"], cursor["x"], cursor["button"], cursor["selected"]) == (bia.id, 1.5, "down", ["s1"])
        assert cursor["viewport"] == viewport

        # Saves reach the board's room too, for whoever missed the live strokes.
        await save(ana, cid, bid, element("s1", 2))
        saved = await next_event(b, "addon.whiteboard.elements")
        assert saved["origin"] == "test" and saved["elements"][0]["version"] == 2
        await no_event(c, "addon.whiteboard.elements")

        # Someone who can only look moves the cursor, but their strokes aren't relayed.
        await send(c, "join", channel_id=cid, board_id=bid, origin="C")
        await next_event(a, "addon.whiteboard.peer.joined")
        await send(c, "update", board_id=bid, elements=[element("x1")], origin="C")
        await no_event(a, "addon.whiteboard.live")
        await send(c, "pointer", board_id=bid, x=0, y=0, origin="C")
        assert (await next_event(a, "addon.whiteboard.pointer"))["user_id"] == leo.id

        # Closing the board, or the connection, tells the others.
        await send(b, "join", channel_id=cid, board_id=None)
        assert (await next_event(a, "addon.whiteboard.peer.left"))["origin"] == "B"
    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as a:
        await next_event(a, "ready")
        await send(a, "join", channel_id=cid, board_id=bid, origin="A")
        async with aconnect_ws(ws_url(bia), wsc) as b:
            await next_event(b, "ready")
            await send(b, "join", channel_id=cid, board_id=bid, origin="B")
            await next_event(a, "addon.whiteboard.peer.joined")
        assert (await next_event(a, "addon.whiteboard.peer.left"))["user_id"] == bia.id


async def test_live_needs_access(client: AsyncClient) -> None:
    owner, outsider = await make_user(client, "owner"), await make_user(client, "outsider")
    sid = (await make_server(owner))["id"]
    cid = await whiteboard_channel(owner, sid)
    bid = (await new_board(owner, cid))["id"]

    async with ws_client() as wsc, aconnect_ws(ws_url(outsider), wsc) as ws:
        await next_event(ws, "ready")
        await send(ws, "join", channel_id=cid, board_id=bid, origin="X")
        assert (await next_event(ws, "error"))["message"] == "Channel not found"
        await send(ws, "join", channel_id=cid, board_id="nope")
        assert (await next_event(ws, "error"))["message"] == "Invalid whiteboard message"
        await send(ws, "dance")
        assert (await next_event(ws, "error"))["message"] == "Unknown message: addon.whiteboard.dance"
        # Not joined: drawing and pointing go nowhere.
        await send(ws, "update", board_id=bid, elements=[element("x1")])
        await send(ws, "pointer", board_id=bid, x=0, y=0)
        await no_event(ws, "addon.whiteboard.live")


async def test_creating_a_board_posts_a_system_line(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    server = await make_server(owner, member)
    sid, chat = server["id"], text_channel(server)
    cid = await whiteboard_channel(owner, sid)

    # Off by default.
    await new_board(member, cid, "Antes")
    assert (await owner.get(f"/channels/{chat}/messages")).json() == []

    assert (await owner.patch(f"/channels/{cid}", {"announce_channel_id": chat})).status_code == 200
    board = await new_board(member, cid, "Mapa do jogo")
    # Renaming, drawing and duplicating aren't news.
    await member.patch(url(cid, f"/boards/{board['id']}"), {"name": "Mapa"})
    await save(member, cid, board["id"], element("a1"))
    messages = (await owner.get(f"/channels/{chat}/messages")).json()
    assert len(messages) == 1
    line = messages[0]
    assert line["author"]["id"] == member.id
    assert line["system"]["addon_key"] == "whiteboard" and line["system"]["source_channel_id"] == cid
    assert line["system"]["lines"] == ["criou o quadro “Mapa do jogo”"]
