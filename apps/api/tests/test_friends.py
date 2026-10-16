from httpx import AsyncClient
from httpx_ws import aconnect_ws

from tests.helpers import ApiUser, make_user, ws_client
from tests.test_ws import next_event, no_event, ws_url


async def kinds(user: ApiUser) -> dict[str, str]:
    res = await user.get("/friends")
    assert res.status_code == 200
    return {f["user"]["username"]: f["kind"] for f in res.json()}


async def befriend(a: ApiUser, b: ApiUser) -> None:
    username = (await b.get("/users/me")).json()["username"]
    assert (await a.post("/friends/requests", {"username": username})).status_code == 201
    assert (await b.post(f"/friends/{a.id}/accept")).status_code == 200


async def test_request_accept_and_unfriend(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")

    res = await ana.post("/friends/requests", {"username": "@BIA"})
    assert res.status_code == 201
    assert res.json()["kind"] == "outgoing" and res.json()["user"]["id"] == bia.id
    assert await kinds(ana) == {"bia": "outgoing"}
    assert await kinds(bia) == {"ana": "incoming"}

    # Sending again is idempotent.
    assert (await ana.post("/friends/requests", {"username": "bia"})).status_code == 200
    # Only the addressee can accept.
    assert (await ana.post(f"/friends/{bia.id}/accept")).status_code == 404

    res = await bia.post(f"/friends/{ana.id}/accept")
    assert res.status_code == 200 and res.json()["kind"] == "friend"
    assert await kinds(ana) == {"bia": "friend"} and await kinds(bia) == {"ana": "friend"}
    assert (await ana.post("/friends/requests", {"username": "bia"})).status_code == 409

    assert (await bia.delete(f"/friends/{ana.id}")).status_code == 204
    assert await kinds(ana) == {} and await kinds(bia) == {}
    assert (await bia.delete(f"/friends/{ana.id}")).status_code == 404


async def test_crossed_requests_become_friendship(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await ana.post("/friends/requests", {"username": "bia"})
    res = await bia.post("/friends/requests", {"username": "ana"})
    assert res.status_code == 201 and res.json()["kind"] == "friend"
    assert await kinds(ana) == {"bia": "friend"}


async def test_decline_cancel_and_bad_requests(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    assert (await ana.post("/friends/requests", {"username": "ana"})).status_code == 400
    assert (await ana.post("/friends/requests", {"username": "nobody"})).status_code == 404

    await ana.post("/friends/requests", {"username": "bia"})
    assert (await bia.delete(f"/friends/{ana.id}")).status_code == 204  # decline
    await ana.post("/friends/requests", {"username": "bia"})
    assert (await ana.delete(f"/friends/{bia.id}")).status_code == 204  # cancel
    assert await kinds(ana) == {} and await kinds(bia) == {}


async def test_block_ends_friendship_and_stays_hidden(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await befriend(ana, bia)

    res = await ana.post(f"/friends/{bia.id}/block")
    assert res.status_code == 200 and res.json()["kind"] == "blocked"
    assert await kinds(ana) == {"bia": "blocked"}
    assert await kinds(bia) == {}  # the blocked person doesn't see the block

    assert (await bia.post("/friends/requests", {"username": "ana"})).status_code == 403
    assert (await ana.post("/friends/requests", {"username": "bia"})).status_code == 409
    # Blocking back is allowed: both blocks exist on their own.
    assert (await bia.post(f"/friends/{ana.id}/block")).status_code == 200
    assert await kinds(bia) == {"ana": "blocked"}

    assert (await ana.delete(f"/friends/{bia.id}/block")).status_code == 204
    assert await kinds(ana) == {}
    assert (await ana.delete(f"/friends/{bia.id}/block")).status_code == 404
    # bia still blocks ana.
    assert (await ana.post("/friends/requests", {"username": "bia"})).status_code == 403


async def test_block_a_pending_request(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await bia.post("/friends/requests", {"username": "ana"})
    assert (await bia.post(f"/friends/{ana.id}/block")).status_code == 200  # same direction as the request
    assert await kinds(bia) == {"ana": "blocked"}
    assert await kinds(ana) == {}


async def test_friend_events(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as aws, aconnect_ws(ws_url(bia), wsc) as bws:
        await next_event(aws, "ready")
        await next_event(bws, "ready")

        await ana.post("/friends/requests", {"username": "bia"})
        assert (await next_event(aws, "friend.updated"))["kind"] == "outgoing"
        incoming = await next_event(bws, "friend.updated")
        assert incoming["kind"] == "incoming" and incoming["user"]["id"] == ana.id

        await bia.post(f"/friends/{ana.id}/accept")
        accepted = await next_event(aws, "friend.updated")
        assert accepted["kind"] == "friend" and accepted["online"] is True
        assert (await next_event(bws, "friend.updated"))["kind"] == "friend"

        await ana.post(f"/friends/{bia.id}/block")
        assert (await next_event(bws, "friend.removed")) == {"user_id": ana.id}
        assert (await next_event(aws, "friend.updated"))["kind"] == "blocked"
        await no_event(bws, "friend.updated")
