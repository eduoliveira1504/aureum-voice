"""Replies: the quote of the original, its mention, and what happens when it's deleted."""

from httpx import AsyncClient

from tests.helpers import make_server, make_user, text_channel
from tests.test_attachments import uploaded
from tests.test_calls import friends_dm
from tests.test_profile import PNG
from tests.test_reads import read_state, say


async def test_reply_quotes_the_original(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia)
    cid = text_channel(server)
    original = await say(ana, cid, "x" * 300)

    res = await bia.post(f"/channels/{cid}/messages", {"content": "concordo", "reply_to_id": original["id"]})
    assert res.status_code == 201, res.text
    reply = res.json()
    assert reply["reply_to_id"] == original["id"]
    quote = reply["reply_to"]
    assert (quote["id"], quote["author"]["username"], len(quote["content"]), quote["media"]) == (original["id"], "ana", 200, None)
    # The history carries the quote too.
    history = (await ana.get(f"/channels/{cid}/messages")).json()
    assert history[-1]["reply_to"]["id"] == original["id"]
    assert history[0]["reply_to"] is None and history[0]["reply_to_id"] is None


async def test_reply_says_what_a_file_only_message_carries(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    cid = text_channel(await make_server(ana))
    image = await uploaded(ana, cid, "foto.png", PNG)
    original = (await ana.post(f"/channels/{cid}/messages", {"attachment_ids": [image["id"]]})).json()
    reply = (await ana.post(f"/channels/{cid}/messages", {"content": "olha", "reply_to_id": original["id"]})).json()
    assert (reply["reply_to"]["content"], reply["reply_to"]["media"]) == ("", "image")


async def test_reply_mentions_the_author_unless_turned_off(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia)
    cid = text_channel(server)
    original = await say(ana, cid, "alguém?")
    assert (await ana.post(f"/channels/{cid}/read", {})).status_code == 200

    await bia.post(f"/channels/{cid}/messages", {"content": "eu", "reply_to_id": original["id"], "mention_reply": False})
    assert (await read_state(ana, server, cid))["mention_count"] == 0
    await bia.post(f"/channels/{cid}/messages", {"content": "eu de novo", "reply_to_id": original["id"]})
    assert (await read_state(ana, server, cid))["mention_count"] == 1
    # Answering yourself isn't a mention.
    await ana.post(f"/channels/{cid}/messages", {"content": "ok", "reply_to_id": original["id"]})
    assert (await read_state(ana, server, cid))["mention_count"] == 1


async def test_reply_only_within_the_conversation(client: AsyncClient) -> None:
    ana, bia, dm = await friends_dm(client)
    cid = text_channel(await make_server(ana))
    elsewhere = await say(ana, cid, "no servidor")
    res = await ana.post(f"/channels/{dm['id']}/messages", {"content": "oi", "reply_to_id": elsewhere["id"]})
    assert res.status_code == 422
    res = await ana.post(f"/channels/{dm['id']}/messages", {"content": "oi", "reply_to_id": 999_999_999})
    assert res.status_code == 422
    # In a DM it works the same.
    first = (await bia.post(f"/channels/{dm['id']}/messages", {"content": "e aí"})).json()
    res = await ana.post(f"/channels/{dm['id']}/messages", {"content": "tudo", "reply_to_id": first["id"]})
    assert res.status_code == 201 and res.json()["reply_to"]["author"]["username"] == "bia"


async def test_deleted_original_leaves_the_id(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    cid = text_channel(await make_server(ana, bia))
    original = await say(ana, cid, "vou apagar")
    reply = (await bia.post(f"/channels/{cid}/messages", {"content": "tarde", "reply_to_id": original["id"]})).json()
    assert (await ana.delete(f"/messages/{original['id']}")).status_code == 204
    history = (await bia.get(f"/channels/{cid}/messages")).json()
    kept = next(m for m in history if m["id"] == reply["id"])
    assert (kept["reply_to_id"], kept["reply_to"]) == (original["id"], None)
    # Editing the reply keeps it a reply.
    edited = (await bia.patch(f"/messages/{reply['id']}", {"content": "tarde demais"})).json()
    assert (edited["reply_to_id"], edited["reply_to"]) == (original["id"], None)
