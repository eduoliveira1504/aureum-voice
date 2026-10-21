"""Reordering a server's channels (PUT /servers/{id}/channels/order): one sidebar section at a
time, saved for everyone in one transaction, live over the WebSocket, MANAGE_CHANNELS only, and
private channels keep their place for those who see them."""

from typing import Any

from httpx import AsyncClient
from httpx_ws import aconnect_ws

from app.permissions import Perm
from tests.helpers import ApiUser, make_server, make_user, ws_client
from tests.test_private_channels import create_private
from tests.test_roles import create_role, give
from tests.test_ws import next_event, no_event, ws_url


async def add(owner: ApiUser, sid: str, name: str, type_: str = "text") -> str:
    res = await owner.post(f"/servers/{sid}/channels", {"name": name, "type": type_})
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def names(user: ApiUser, sid: str, type_: str) -> list[str]:
    channels = (await user.get(f"/servers/{sid}")).json()["channels"]
    return [c["name"] for c in channels if c["type"] == type_]


async def order(user: ApiUser, sid: str, type_: str, ids: list[str]) -> Any:
    return await user.put(f"/servers/{sid}/channels/order", {"type": type_, "channel_ids": ids})


def ids_by_name(server: dict[str, Any]) -> dict[str, str]:
    return {c["name"]: c["id"] for c in server["channels"]}


async def test_reorder_a_section_live_for_everyone(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    sid = (await make_server(owner, member))["id"]
    for name in ("Ranked", "Estudos"):
        await add(owner, sid, name, "voice")
    await add(owner, sid, "memes")
    ids = ids_by_name((await owner.get(f"/servers/{sid}")).json())
    assert await names(member, sid, "voice") == ["Geral", "Ranked", "Estudos"]

    async with ws_client() as wsc, aconnect_ws(ws_url(member), wsc) as ws:
        await next_event(ws, "ready")
        res = await order(owner, sid, "voice", [ids["Estudos"], ids["Geral"], ids["Ranked"]])
        assert res.status_code == 200, res.text
        event = await next_event(ws, "channels.reordered")
        assert event["server_id"] == sid
        moved = {c["id"]: c["position"] for c in event["channels"]}
        assert moved[ids["Estudos"]] < moved[ids["Geral"]] < moved[ids["Ranked"]]

    assert await names(member, sid, "voice") == ["Estudos", "Geral", "Ranked"]
    # The other sections keep their order.
    assert await names(member, sid, "text") == ["geral", "memes"]
    positions = {p["id"]: p["position"] for p in res.json()}
    assert len(set(positions.values())) == len(positions) == 5


async def test_needs_manage_channels(client: AsyncClient) -> None:
    owner, member, organizer = [await make_user(client, n) for n in ("owner", "member", "organizer")]
    server = await make_server(owner, member, organizer)
    sid = server["id"]
    second = await add(owner, sid, "memes")
    first = ids_by_name(server)["geral"]
    assert (await order(member, sid, "text", [second, first])).status_code == 403
    assert await names(owner, sid, "text") == ["geral", "memes"]
    await give(owner, sid, organizer, await create_role(owner, sid, "Organização", Perm.MANAGE_CHANNELS))
    assert (await order(organizer, sid, "text", [second, first])).status_code == 200
    assert await names(owner, sid, "text") == ["memes", "geral"]


async def test_the_list_must_be_the_whole_section(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    server = await make_server(owner)
    sid = server["id"]
    other = await make_server(owner, name="Outro")
    ids = ids_by_name(server)
    memes = await add(owner, sid, "memes")
    foreign = ids_by_name(other)["geral"]
    bad = [
        ("text", [ids["geral"]]),  # missing one
        ("text", [ids["geral"], memes, memes]),  # repeated
        ("text", [ids["geral"], foreign]),  # another server's
        ("text", [ids["geral"], memes, foreign]),
        ("voice", [ids["geral"], memes]),  # wrong section
        ("text", []),
    ]
    for type_, channel_ids in bad:
        assert (await order(owner, sid, type_, channel_ids)).status_code == 422, (type_, channel_ids)
    assert (await order(owner, other["id"], "text", [ids["geral"], memes])).status_code == 422
    stranger = await make_user(client, "stranger")
    assert (await order(stranger, sid, "text", [memes, ids["geral"]])).status_code == 404
    assert await names(owner, sid, "text") == ["geral", "memes"]


async def test_private_channels_keep_their_place(client: AsyncClient) -> None:
    owner, organizer = await make_user(client, "owner"), await make_user(client, "organizer")
    server = await make_server(owner, organizer)
    sid = server["id"]
    await give(owner, sid, organizer, await create_role(owner, sid, "Organização", Perm.MANAGE_CHANNELS))
    ids = ids_by_name(server)
    staff = (await create_private(owner, sid))["id"]  # "staff", hidden from the organizer
    memes = await add(owner, sid, "memes")
    assert await names(owner, sid, "text") == ["geral", "staff", "memes"]

    async with ws_client() as wsc, aconnect_ws(ws_url(organizer), wsc) as ws:
        await next_event(ws, "ready")
        # The organizer lists only what they see; a list with the hidden one is refused.
        assert (await order(organizer, sid, "text", [memes, staff, ids["geral"]])).status_code == 422
        res = await order(organizer, sid, "text", [memes, ids["geral"]])
        assert res.status_code == 200
        assert staff not in {p["id"] for p in res.json()}
        event = await next_event(ws, "channels.reordered")
        assert staff not in {c["id"] for c in event["channels"]}
        await no_event(ws, "channels.reordered")

    # The hidden channel stays in its slot between the two the organizer swapped.
    assert await names(owner, sid, "text") == ["memes", "staff", "geral"]
    assert await names(organizer, sid, "text") == ["memes", "geral"]
