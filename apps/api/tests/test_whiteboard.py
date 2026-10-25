"""The whiteboard addon: boards, scenes and sync, images, versions, permissions, live events."""

from typing import Any

from httpx import AsyncClient
from httpx_ws import aconnect_ws
from sqlalchemy import func, select

from app.addons.whiteboard.models import WhiteboardBoard
from app.db import SessionLocal
from app.permissions import DEFAULT_EVERYONE, Perm
from tests.helpers import ApiUser, make_server, make_user, ws_client
from tests.test_ws import next_event, ws_url


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
