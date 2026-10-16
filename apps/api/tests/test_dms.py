from httpx import AsyncClient
from httpx_ws import aconnect_ws

from tests.helpers import ApiUser, make_user, ws_client
from tests.test_friends import befriend
from tests.test_ws import next_event, no_event, ws_url


async def dm_ids(user: ApiUser) -> list[str]:
    res = await user.get("/dms")
    assert res.status_code == 200
    return [d["id"] for d in res.json()]


async def open_dm(a: ApiUser, b: ApiUser) -> dict:
    res = await a.post("/dms", {"user_id": b.id})
    assert res.status_code in (200, 201), res.text
    return res.json()


async def test_dm_needs_friendship_and_is_unique(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    assert (await ana.post("/dms", {"user_id": bia.id})).status_code == 403
    assert (await ana.post("/dms", {"user_id": ana.id})).status_code == 400

    await befriend(ana, bia)
    res = await ana.post("/dms", {"user_id": bia.id})
    assert res.status_code == 201
    dm = res.json()
    assert dm["type"] == "dm" and dm["name"] is None
    assert {m["user"]["id"] for m in dm["members"]} == {ana.id, bia.id}
    # Same pair, same conversation, whoever opens it.
    assert (await ana.post("/dms", {"user_id": bia.id})).json()["id"] == dm["id"]
    assert (await open_dm(bia, ana))["id"] == dm["id"]


async def test_dm_shows_up_for_the_other_side_with_the_first_message(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await befriend(ana, bia)
    dm = await open_dm(ana, bia)
    assert await dm_ids(ana) == [dm["id"]]
    assert await dm_ids(bia) == []

    async with ws_client() as wsc, aconnect_ws(ws_url(bia), wsc) as bws:
        await next_event(bws, "ready")
        res = await ana.post(f"/channels/{dm['id']}/messages", {"content": "oi"})
        assert res.status_code == 201
        # The conversation arrives first, without the message; its event then counts it once.
        created = await next_event(bws, "dm.created")
        assert created["id"] == dm["id"] and created["read"]["unread_count"] == 0
        message = await next_event(bws, "message.created")
        assert message["content"] == "oi" and message["server_id"] is None

    listed = (await bia.get("/dms")).json()
    assert [d["id"] for d in listed] == [dm["id"]]
    assert listed[0]["read"]["unread_count"] == 1 and listed[0]["last_message_id"] == res.json()["id"]

    read = await bia.post(f"/channels/{dm['id']}/read")
    assert read.json()["unread_count"] == 0
    messages = (await bia.get(f"/channels/{dm['id']}/messages")).json()
    assert [m["content"] for m in messages] == ["oi"]


async def test_strangers_cant_read_and_only_friends_write(client: AsyncClient) -> None:
    ana, bia, eve = await make_user(client, "ana"), await make_user(client, "bia"), await make_user(client, "eve")
    await befriend(ana, bia)
    dm = await open_dm(ana, bia)
    msg = (await ana.post(f"/channels/{dm['id']}/messages", {"content": "oi"})).json()

    assert (await eve.get(f"/channels/{dm['id']}/messages")).status_code == 404
    assert (await eve.post(f"/channels/{dm['id']}/messages", {"content": "x"})).status_code == 404
    assert (await eve.delete(f"/messages/{msg['id']}")).status_code == 404
    # In a DM only the author deletes.
    assert (await bia.delete(f"/messages/{msg['id']}")).status_code == 403

    await bia.post(f"/friends/{ana.id}/block")
    assert (await ana.post(f"/channels/{dm['id']}/messages", {"content": "?"})).status_code == 403
    assert (await bia.post(f"/channels/{dm['id']}/messages", {"content": "?"})).status_code == 403
    # History stays readable.
    assert (await ana.get(f"/channels/{dm['id']}/messages")).status_code == 200


async def test_close_and_reopen_dm(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await befriend(ana, bia)
    dm = await open_dm(ana, bia)
    await ana.post(f"/channels/{dm['id']}/messages", {"content": "oi"})

    assert (await bia.delete(f"/dms/{dm['id']}")).status_code == 204
    assert await dm_ids(bia) == []
    await ana.post(f"/channels/{dm['id']}/messages", {"content": "volta"})
    assert await dm_ids(bia) == [dm["id"]]

    await bia.delete(f"/dms/{dm['id']}")
    assert (await open_dm(bia, ana))["id"] == dm["id"]
    assert await dm_ids(bia) == [dm["id"]]


async def test_groups(client: AsyncClient) -> None:
    ana, bia, cai, eve = (
        await make_user(client, "ana"),
        await make_user(client, "bia"),
        await make_user(client, "cai"),
        await make_user(client, "eve"),
    )
    await befriend(ana, bia)
    await befriend(ana, cai)

    # Only friends can be put in a group.
    assert (await ana.post("/dms/groups", {"user_ids": [bia.id, eve.id]})).status_code == 403
    assert (await ana.post("/dms/groups", {"user_ids": [ana.id]})).status_code == 400

    async with ws_client() as wsc, aconnect_ws(ws_url(bia), wsc) as bws:
        await next_event(bws, "ready")
        res = await ana.post("/dms/groups", {"user_ids": [bia.id], "name": "Squad"})
        assert res.status_code == 201
        group = res.json()
        assert group["type"] == "group_dm" and group["name"] == "Squad"
        assert (await next_event(bws, "dm.created"))["id"] == group["id"]

        await bia.post(f"/channels/{group['id']}/messages", {"content": "antes"})
        res = await ana.post(f"/dms/{group['id']}/members", {"user_ids": [cai.id]})
        assert res.status_code == 200 and len(res.json()["members"]) == 3
        assert len((await next_event(bws, "dm.updated"))["members"]) == 3

    # The newcomer sees the history, but not as unread.
    cai_view = next(d for d in (await cai.get("/dms")).json() if d["id"] == group["id"])
    assert cai_view["read"]["unread_count"] == 0
    assert len((await cai.get(f"/channels/{group['id']}/messages")).json()) == 1

    # bia isn't friends with cai, but anyone in the group writes and renames.
    assert (await bia.post(f"/channels/{group['id']}/messages", {"content": "oi cai"})).status_code == 201
    assert (await bia.patch(f"/dms/{group['id']}", {"name": "Trio"})).json()["name"] == "Trio"
    # Adding still needs the adder's friendship.
    assert (await bia.post(f"/dms/{group['id']}/members", {"user_ids": [eve.id]})).status_code == 403
    assert (await eve.patch(f"/dms/{group['id']}", {"name": "x"})).status_code == 404

    assert (await bia.delete(f"/dms/{group['id']}")).status_code == 204
    assert group["id"] not in await dm_ids(bia)
    assert (await bia.get(f"/channels/{group['id']}/messages")).status_code == 404
    assert len((await ana.get("/dms")).json()[0]["members"]) == 2

    await ana.delete(f"/dms/{group['id']}")
    await cai.delete(f"/dms/{group['id']}")
    assert (await ana.get(f"/channels/{group['id']}/messages")).status_code == 404  # deleted with its last member


async def test_group_size_limit(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    friends = [await make_user(client, f"friend{i}") for i in range(10)]
    for f in friends:
        await befriend(owner, f)
    res = await owner.post("/dms/groups", {"user_ids": [f.id for f in friends[:9]]})
    assert res.status_code == 201 and len(res.json()["members"]) == 10
    res = await owner.post(f"/dms/{res.json()['id']}/members", {"user_ids": [friends[9].id]})
    assert res.status_code == 400
    assert (await owner.post("/dms/groups", {"user_ids": [f.id for f in friends]})).status_code == 422


async def test_dm_messages_dont_reach_servers(client: AsyncClient) -> None:
    ana, bia, eve = await make_user(client, "ana"), await make_user(client, "bia"), await make_user(client, "eve")
    await befriend(ana, bia)
    dm = await open_dm(ana, bia)
    async with ws_client() as wsc, aconnect_ws(ws_url(eve), wsc) as ews:
        await next_event(ews, "ready")
        await ana.post(f"/channels/{dm['id']}/messages", {"content": "secret"})
        await no_event(ews, "message.created")


async def test_profile_updates_reach_friends_without_a_shared_server(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await befriend(ana, bia)
    async with ws_client() as wsc, aconnect_ws(ws_url(bia), wsc) as bws:
        await next_event(bws, "ready")
        await ana.patch("/users/me", {"display_name": "Ana B."})
        assert (await next_event(bws, "user.updated"))["display_name"] == "Ana B."
