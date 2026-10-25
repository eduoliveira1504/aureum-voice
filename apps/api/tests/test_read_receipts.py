"""Block 3.11 (part B): read receipts in 1:1 DMs (app/receipts.py)."""

from typing import Any

from httpx import AsyncClient
from httpx_ws import aconnect_ws
from sqlalchemy import select

from app import bot
from app.db import SessionLocal
from app.models import User
from tests.helpers import ApiUser, make_user, ws_client
from tests.test_bot import aureum, official_dm  # noqa: F401 (fixture)
from tests.test_dms import open_dm
from tests.test_friends import befriend
from tests.test_reads import say
from tests.test_ws import next_event, no_event, ws_url


async def dm_of(user: ApiUser, channel_id: str) -> dict[str, Any]:
    return next(d for d in (await user.get("/dms")).json() if d["id"] == channel_id)


async def receipts(user: ApiUser, on: bool) -> None:
    res = await user.patch("/users/me/settings", {"read_receipts": on})
    assert res.status_code == 200 and res.json()["read_receipts"] is on


async def test_the_other_side_sees_what_i_read_live(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await befriend(ana, bia)
    dm = await open_dm(ana, bia)
    first = await say(ana, dm["id"], "oi")
    assert (await dm_of(ana, dm["id"]))["peer_read_message_id"] == 0

    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as aws:
        await next_event(aws, "ready")
        await bia.post(f"/channels/{dm['id']}/read")
        seen = await next_event(aws, "dm.read")
        assert seen == {"channel_id": dm["id"], "last_read_message_id": first["id"]}
    assert (await dm_of(ana, dm["id"]))["peer_read_message_id"] == first["id"]


async def test_off_hides_both_ways(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await befriend(ana, bia)
    dm = await open_dm(ana, bia)
    first = await say(ana, dm["id"], "oi")
    await say(bia, dm["id"], "olá")
    await bia.post(f"/channels/{dm['id']}/read")

    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as aws:
        await next_event(aws, "ready")
        await receipts(bia, False)
        # Ana's app hides what it showed.
        assert await next_event(aws, "dm.read") == {"channel_id": dm["id"], "last_read_message_id": None}
        await ana.post(f"/channels/{dm['id']}/read")
        await say(ana, dm["id"], "leu?")
        await bia.post(f"/channels/{dm['id']}/read")
        await no_event(aws, "dm.read")

    # Neither sees the other: Bia turned it off, so she doesn't see Ana's reads either.
    assert (await dm_of(ana, dm["id"]))["peer_read_message_id"] is None
    assert (await dm_of(bia, dm["id"]))["peer_read_message_id"] is None

    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as aws:
        await next_event(aws, "ready")
        await receipts(bia, True)
        back = await next_event(aws, "dm.read")
        assert back["channel_id"] == dm["id"] and back["last_read_message_id"] > first["id"]
    assert (await dm_of(bia, dm["id"]))["peer_read_message_id"] is not None


async def test_only_one_to_one_dms(client: AsyncClient, aureum) -> None:  # noqa: ANN001, F811
    ana, bia, eve = await make_user(client, "ana"), await make_user(client, "bia"), await make_user(client, "eve")
    await befriend(ana, bia)
    await befriend(ana, eve)
    group = (await ana.post("/dms/groups", {"user_ids": [bia.id, eve.id]})).json()
    await say(ana, group["id"], "oi grupo")
    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as aws:
        await next_event(aws, "ready")
        await bia.post(f"/channels/{group['id']}/read")
        await no_event(aws, "dm.read")
    assert (await dm_of(ana, group["id"]))["peer_read_message_id"] is None

    async with SessionLocal() as session:
        user = await session.scalar(select(User).where(User.id == ana.id))
        assert await bot.send_dm(session, user, "avisos", "Olá!")
    official = await official_dm(ana)
    await ana.post(f"/channels/{official['id']}/read")
    assert (await official_dm(ana))["peer_read_message_id"] is None
