from typing import Any

from httpx import AsyncClient
from httpx_ws import aconnect_ws

from app.reads import mentioned_usernames
from tests.helpers import ApiUser, make_server, make_user, text_channel, ws_client
from tests.test_ws import next_event, ws_url


async def read_state(user: ApiUser, server: dict[str, Any], channel_id: str) -> dict[str, Any]:
    detail = (await user.get(f"/servers/{server['id']}")).json()
    return next(r for r in detail["reads"] if r["channel_id"] == channel_id)


async def say(user: ApiUser, channel_id: str, content: str) -> dict[str, Any]:
    res = await user.post(f"/channels/{channel_id}/messages", {"content": content})
    assert res.status_code == 201, res.text
    return res.json()


def test_mention_parsing() -> None:
    assert mentioned_usernames("oi @Bob e @carol.") == {"bob", "carol"}
    assert mentioned_usernames("mail me at bob@example.com") == set()
    assert mentioned_usernames("@ab is too short") == set()


async def test_unread_counts_others_messages_only(client: AsyncClient) -> None:
    alice, bob = await make_user(client, "alice"), await make_user(client, "bob")
    server = await make_server(alice, bob)
    cid = text_channel(server)

    await say(alice, cid, "one")
    await say(alice, cid, "two")
    await say(bob, cid, "mine")
    state = await read_state(bob, server, cid)
    assert (state["unread_count"], state["mention_count"]) == (2, 0)
    assert (await read_state(alice, server, cid))["unread_count"] == 1


async def test_newcomers_start_with_history_read(client: AsyncClient) -> None:
    alice, bob = await make_user(client, "alice"), await make_user(client, "bob")
    server = await make_server(alice)
    cid = text_channel(server)
    await say(alice, cid, "before bob")

    code = (await alice.post(f"/servers/{server['id']}/invites", {})).json()["code"]
    await bob.post(f"/invites/{code}/join")
    assert (await read_state(bob, server, cid))["unread_count"] == 0
    await say(alice, cid, "after bob")
    assert (await read_state(bob, server, cid))["unread_count"] == 1


async def test_channels_created_later_count_from_the_start(client: AsyncClient) -> None:
    alice, bob = await make_user(client, "alice"), await make_user(client, "bob")
    server = await make_server(alice, bob)
    cid = (await alice.post(f"/servers/{server['id']}/channels", {"name": "memes"})).json()["id"]
    await say(alice, cid, "first")
    assert (await read_state(bob, server, cid))["unread_count"] == 1


async def test_mentions_and_mark_read(client: AsyncClient) -> None:
    alice, bob = await make_user(client, "alice"), await make_user(client, "bob")
    outsider = await make_user(client, "outsider")
    server = await make_server(alice, bob)
    cid = text_channel(server)

    await say(alice, cid, "@bob olha isso")
    await say(alice, cid, "@BOB de novo, e @outsider e @alice")
    last = await say(alice, cid, "sem menção")
    assert (await read_state(bob, server, cid))["mention_count"] == 2
    # Not a member, and self-mentions don't count.
    assert (await read_state(alice, server, cid))["mention_count"] == 0
    assert (await outsider.get(f"/servers/{server['id']}")).status_code == 404

    res = await bob.post(f"/channels/{cid}/read")
    assert res.status_code == 200
    assert res.json() == {"channel_id": cid, "last_read_message_id": last["id"], "unread_count": 0, "mention_count": 0}
    assert (await read_state(bob, server, cid))["unread_count"] == 0


async def test_read_marker_never_moves_back(client: AsyncClient) -> None:
    alice, bob = await make_user(client, "alice"), await make_user(client, "bob")
    server = await make_server(alice, bob)
    cid = text_channel(server)
    first = await say(alice, cid, "1")
    await say(alice, cid, "2")
    third = await say(alice, cid, "3")

    res = await bob.post(f"/channels/{cid}/read", {"message_id": first["id"]})
    assert (res.json()["last_read_message_id"], res.json()["unread_count"]) == (first["id"], 2)
    await bob.post(f"/channels/{cid}/read")
    res = await bob.post(f"/channels/{cid}/read", {"message_id": first["id"]})
    assert (res.json()["last_read_message_id"], res.json()["unread_count"]) == (third["id"], 0)
    # Ids past the newest message are clamped to it.
    res = await bob.post(f"/channels/{cid}/read", {"message_id": third["id"] + 1000})
    assert res.json()["last_read_message_id"] == third["id"]


async def test_mark_unread_moves_the_marker_back(client: AsyncClient) -> None:
    alice, bob, outsider = [await make_user(client, n) for n in ("alice", "bob", "outsider")]
    server = await make_server(alice, bob)
    cid = text_channel(server)
    first = await say(alice, cid, "one")
    second = await say(alice, cid, "two @bob")
    await say(bob, cid, "mine")
    await say(alice, cid, "three")
    assert (await bob.post(f"/channels/{cid}/read", {})).status_code == 200

    res = await bob.post(f"/channels/{cid}/unread", {"message_id": second["id"]})
    assert res.status_code == 200, res.text
    # From "two" on, others' messages: "two" and "three" (not bob's own).
    assert (res.json()["last_read_message_id"], res.json()["unread_count"]) == (first["id"], 2)
    assert (await read_state(bob, server, cid))["unread_count"] == 2
    # The first message: everything unread.
    res = await bob.post(f"/channels/{cid}/unread", {"message_id": first["id"]})
    assert (res.json()["last_read_message_id"], res.json()["unread_count"]) == (0, 3)

    other = text_channel(await make_server(alice))
    elsewhere = await say(alice, other, "x")
    assert (await bob.post(f"/channels/{cid}/unread", {"message_id": elsewhere["id"]})).status_code == 404
    assert (await outsider.post(f"/channels/{cid}/unread", {"message_id": first["id"]})).status_code == 404


async def test_mark_read_needs_membership_and_a_text_channel(client: AsyncClient) -> None:
    alice, outsider = await make_user(client, "alice"), await make_user(client, "outsider")
    server = await make_server(alice)
    voice_id = next(c["id"] for c in server["channels"] if c["type"] == "voice")
    assert (await outsider.post(f"/channels/{text_channel(server)}/read")).status_code == 404
    assert (await alice.post(f"/channels/{voice_id}/read")).status_code == 400


async def test_unread_feed(client: AsyncClient) -> None:
    alice, bob = await make_user(client, "alice"), await make_user(client, "bob")
    server = await make_server(alice, bob)
    cid = text_channel(server)
    other = (await alice.post(f"/servers/{server['id']}/channels", {"name": "clips"})).json()["id"]

    a = await say(alice, cid, "a")
    b = await say(alice, other, "b")
    await say(bob, cid, "bob's own")
    feed = (await bob.get(f"/servers/{server['id']}/unread")).json()
    assert [m["id"] for m in feed] == [b["id"], a["id"]]

    await bob.post(f"/channels/{other}/read")
    assert [m["id"] for m in (await bob.get(f"/servers/{server['id']}/unread")).json()] == [a["id"]]
    assert (await bob.get(f"/servers/{server['id']}/unread", params={"limit": 0})).status_code == 422


async def test_leaving_forgets_read_state(client: AsyncClient) -> None:
    alice, bob = await make_user(client, "alice"), await make_user(client, "bob")
    server = await make_server(alice, bob)
    cid = text_channel(server)
    await say(alice, cid, "before leaving")
    await bob.delete(f"/servers/{server['id']}/members/me")

    # Coming back starts fresh at the latest message.
    code = (await alice.post(f"/servers/{server['id']}/invites", {})).json()["code"]
    await bob.post(f"/invites/{code}/join")
    assert (await read_state(bob, server, cid))["unread_count"] == 0


async def test_events(client: AsyncClient) -> None:
    alice, bob = await make_user(client, "alice"), await make_user(client, "bob")
    server = await make_server(alice, bob)
    cid = text_channel(server)

    async with ws_client() as wsc, aconnect_ws(ws_url(bob), wsc) as ws:
        await next_event(ws, "ready")
        await say(alice, cid, "oi @bob")
        created = await next_event(ws, "message.created")
        assert created["mentions"] == [bob.id] and created["server_id"] == server["id"]

        await bob.post(f"/channels/{cid}/read")
        updated = await next_event(ws, "read.updated")
        assert (updated["channel_id"], updated["server_id"], updated["mention_count"]) == (cid, server["id"], 0)


async def test_mark_a_whole_server_read(client: AsyncClient) -> None:
    alice, bob = await make_user(client, "alice"), await make_user(client, "bob")
    server = await make_server(alice, bob)
    general = text_channel(server)
    memes = (await alice.post(f"/servers/{server['id']}/channels", {"name": "memes"})).json()["id"]
    await say(alice, general, "oi @bob")
    await say(alice, memes, "lol")

    async with ws_client() as wsc, aconnect_ws(ws_url(bob), wsc) as ws:
        await next_event(ws, "ready")
        res = await bob.post(f"/servers/{server['id']}/read")
        assert res.status_code == 200
        assert {s["channel_id"] for s in res.json()} == {general, memes}
        # Bob's other devices clear their badges.
        assert (await next_event(ws, "read.updated"))["server_id"] == server["id"]

    for cid in (general, memes):
        state = await read_state(bob, server, cid)
        assert (state["unread_count"], state["mention_count"]) == (0, 0)
    outsider = await make_user(client, "dave")
    assert (await outsider.post(f"/servers/{server['id']}/read")).status_code == 404
