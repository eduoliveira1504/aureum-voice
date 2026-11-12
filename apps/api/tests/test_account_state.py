"""Block 4.2.2: deactivating an account and signing in again to reactivate it."""

from httpx import AsyncClient
from httpx_ws import aconnect_ws

from tests.helpers import PASSWORD, ApiUser, make_user, text_channel, ws_client, make_server
from tests.test_friends import befriend
from tests.test_ws import next_event, ws_url


async def login(client: AsyncClient, user: ApiUser) -> ApiUser:
    res = await client.post("/api/auth/login", json={"email": user.email, "password": PASSWORD})
    assert res.status_code == 200, res.text
    token = res.json()["access_token"]
    me = await client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    return ApiUser(client, token, me.json())


async def test_deactivate_needs_the_password(client: AsyncClient) -> None:
    user = await make_user(client, "ana")
    assert (await user.post("/users/me/deactivate", {"password": "wrong-password"})).status_code == 403
    assert (await user.get("/users/me")).status_code == 200


async def test_deactivated_account_disappears_for_others(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await befriend(ana, bia)
    await ana.patch("/users/me", {"bio": "oi"})
    server = await make_server(ana, bia)
    await ana.post(f"/channels/{text_channel(server)}/messages", {"content": "fica aqui"})

    async with ws_client() as wsc, aconnect_ws(ws_url(bia), wsc) as bws:
        assert (await ana.post("/users/me/deactivate", {"password": PASSWORD})).status_code == 204
        assert (await next_event(bws, "friend.removed"))["user_id"] == ana.id

    # Signed out everywhere.
    assert (await ana.get("/users/me")).status_code == 401
    # Out of friend lists, no new DM, group or request.
    assert (await bia.get("/friends")).json() == []
    assert (await bia.post("/dms", {"user_id": ana.id})).status_code == 403
    assert (await bia.post("/dms/groups", {"user_ids": [ana.id]})).status_code == 403
    assert (await bia.post("/friends/requests", {"username": "ana"})).status_code == 404
    # The profile shows only the name and avatar.
    profile = (await bia.get(f"/users/{ana.id}")).json()
    assert profile["deactivated"] is True and profile["bio"] is None and profile["display_name"] == "ana"
    # Messages stay.
    messages = (await bia.get(f"/channels/{text_channel(server)}/messages")).json()
    assert any(m["content"] == "fica aqui" and m["author"]["id"] == ana.id for m in messages)


async def test_signing_in_reactivates(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await befriend(ana, bia)
    await ana.patch("/users/me", {"bio": "oi"})
    await ana.post("/users/me/deactivate", {"password": PASSWORD})

    async with ws_client() as wsc, aconnect_ws(ws_url(bia), wsc) as bws:
        ana = await login(client, ana)
        assert (await next_event(bws, "friend.updated"))["user"]["id"] == ana.id

    assert (await ana.get("/users/me")).json()["deactivated"] is False
    assert [f["user"]["id"] for f in (await bia.get("/friends")).json()] == [ana.id]
    assert (await bia.get(f"/users/{ana.id}")).json()["bio"] == "oi"
    assert (await bia.post("/dms", {"user_id": ana.id})).status_code in (200, 201)


async def test_wrong_password_does_not_reactivate(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await ana.post("/users/me/deactivate", {"password": PASSWORD})
    res = await client.post("/api/auth/login", json={"email": ana.email, "password": "wrong-password"})
    assert res.status_code == 401
    assert (await bia.get(f"/users/{ana.id}")).json()["deactivated"] is True
