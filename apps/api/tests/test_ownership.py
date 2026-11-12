"""Block 4.2.2: the owner hands the server to another member."""

from httpx import AsyncClient
from httpx_ws import aconnect_ws

from tests.helpers import PASSWORD, make_server, make_user, ws_client
from tests.test_ws import next_event, ws_url


async def test_owner_transfers_the_server(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia)
    async with ws_client() as wsc, aconnect_ws(ws_url(bia), wsc) as bws:
        res = await ana.post(f"/servers/{server['id']}/transfer", {"user_id": bia.id})
        assert res.status_code == 200 and res.json()["owner_id"] == bia.id
        assert (await next_event(bws, "server.updated"))["owner_id"] == bia.id
    # The old owner is a plain member now: they can't transfer it back, the new one can.
    assert (await ana.post(f"/servers/{server['id']}/transfer", {"user_id": ana.id})).status_code == 403
    assert (await bia.post(f"/servers/{server['id']}/transfer", {"user_id": ana.id})).status_code == 200


async def test_transfer_rules(client: AsyncClient) -> None:
    ana, bia, cris = await make_user(client, "ana"), await make_user(client, "bia"), await make_user(client, "cris")
    server = await make_server(ana, bia)
    path = f"/servers/{server['id']}/transfer"
    # Members other than the owner can't, and only members can receive it.
    assert (await bia.post(path, {"user_id": bia.id})).status_code == 403
    assert (await ana.post(path, {"user_id": cris.id})).status_code == 404
    assert (await ana.post(path, {"user_id": ana.id})).status_code == 400
    # Not to a deactivated account.
    await bia.post("/users/me/deactivate", {"password": PASSWORD})
    assert (await ana.post(path, {"user_id": bia.id})).status_code == 409
    assert (await ana.get(f"/servers/{server['id']}")).json()["owner_id"] == ana.id
