from httpx import AsyncClient

from tests.helpers import make_server, make_user, text_channel


async def test_send_and_paginate(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    cid = text_channel(await make_server(owner))
    for i in range(5):
        assert (await owner.post(f"/channels/{cid}/messages", {"content": f"msg {i}"})).status_code == 201

    page = (await owner.get(f"/channels/{cid}/messages", params={"limit": 3})).json()
    assert [m["content"] for m in page] == ["msg 2", "msg 3", "msg 4"]
    assert page[0]["author"]["id"] == owner.id

    older = (await owner.get(f"/channels/{cid}/messages", params={"limit": 3, "before": page[0]["id"]})).json()
    assert [m["content"] for m in older] == ["msg 0", "msg 1"]


async def test_message_validation_and_access(client: AsyncClient) -> None:
    owner, stranger = await make_user(client, "owner"), await make_user(client, "stranger")
    server = await make_server(owner)
    cid = text_channel(server)
    voice = next(c["id"] for c in server["channels"] if c["type"] == "voice")

    assert (await owner.post(f"/channels/{cid}/messages", {"content": "   "})).status_code == 422
    assert (await owner.post(f"/channels/{cid}/messages", {"content": "x" * 4001})).status_code == 422
    assert (await owner.post(f"/channels/{voice}/messages", {"content": "hi"})).status_code == 400
    assert (await stranger.post(f"/channels/{cid}/messages", {"content": "hi"})).status_code == 404
    assert (await stranger.get(f"/channels/{cid}/messages")).status_code == 404


async def test_edit_and_delete_permissions(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    alice = await make_user(client, "alice")
    bob = await make_user(client, "bob")
    cid = text_channel(await make_server(owner, alice, bob))

    msg = (await alice.post(f"/channels/{cid}/messages", {"content": "hello"})).json()

    assert (await bob.patch(f"/messages/{msg['id']}", {"content": "hijack"})).status_code == 403
    assert (await owner.patch(f"/messages/{msg['id']}", {"content": "hijack"})).status_code == 403
    edited = await alice.patch(f"/messages/{msg['id']}", {"content": "hello!"})
    assert edited.status_code == 200
    assert edited.json()["content"] == "hello!" and edited.json()["edited_at"] is not None

    assert (await bob.delete(f"/messages/{msg['id']}")).status_code == 403
    assert (await owner.delete(f"/messages/{msg['id']}")).status_code == 204  # moderators can delete
    assert (await owner.get(f"/channels/{cid}/messages")).json() == []
