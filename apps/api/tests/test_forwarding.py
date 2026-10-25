"""Forwarding: a snapshot of the original sent to up to 5 conversations the user can write in."""

from httpx import AsyncClient

from app import storage
from app.permissions import Perm
from tests.helpers import make_server, make_user, text_channel
from tests.test_attachments import download, uploaded
from tests.test_calls import friends_dm
from tests.test_profile import PNG
from tests.test_reads import say


async def test_forward_to_several_conversations(client: AsyncClient) -> None:
    ana, bia, dm = await friends_dm(client)
    server = await make_server(ana, bia, name="Galera")
    cid = text_channel(server)
    original = await say(bia, cid, "olha que @ana legal")

    res = await ana.post(f"/messages/{original['id']}/forward", {"channel_ids": [dm["id"], cid], "comment": "vê isso"})
    assert res.status_code == 201, res.text
    sent = res.json()
    assert [m["channel_id"] for m in sent] == [dm["id"], cid]
    copy = sent[0]
    assert copy["content"] == "vê isso" and copy["author"]["username"] == "ana"
    carried = copy["forwarded_from"]
    assert carried["content"] == "olha que @ana legal"
    assert carried["source"] == {
        "kind": "server",
        "server_id": server["id"],
        "server_name": "Galera",
        "channel_id": cid,
        "channel_name": "geral",
        "message_id": original["id"],
    }
    # The copy stays when the original goes.
    assert (await bia.delete(f"/messages/{original['id']}")).status_code == 204
    history = (await bia.get(f"/channels/{dm['id']}/messages")).json()
    assert history[-1]["forwarded_from"]["content"] == "olha que @ana legal"


async def test_forward_from_a_dm_hides_who_was_in_it(client: AsyncClient) -> None:
    ana, bia, dm = await friends_dm(client)
    cid = text_channel(await make_server(ana))
    private = (await bia.post(f"/channels/{dm['id']}/messages", {"content": "segredo"})).json()
    sent = (await ana.post(f"/messages/{private['id']}/forward", {"channel_ids": [cid]})).json()
    assert sent[0]["forwarded_from"]["source"] == {"kind": "dm"}
    assert sent[0]["content"] == ""
    # Forwarding the forward passes the first one on.
    again = (await ana.post(f"/messages/{sent[0]['id']}/forward", {"channel_ids": [dm["id"]]})).json()
    assert again[0]["forwarded_from"]["content"] == "segredo"
    assert again[0]["forwarded_from"]["source"] == {"kind": "dm"}


async def test_forward_only_where_you_can_send(client: AsyncClient) -> None:
    ana, bia, dm = await friends_dm(client)
    owner = await make_user(client, "owner")
    server = await make_server(owner, ana)
    sid, cid = server["id"], text_channel(server)
    elsewhere = text_channel(await make_server(bia))
    mine = await say(ana, cid, "oi")

    # A server you're not in, or a message you can't see.
    assert (await ana.post(f"/messages/{mine['id']}/forward", {"channel_ids": [elsewhere]})).status_code == 404
    hidden = await say(bia, elsewhere, "não é pra você")
    assert (await ana.post(f"/messages/{hidden['id']}/forward", {"channel_ids": [dm["id"]]})).status_code == 404
    # Without SEND_MESSAGES there, nothing is sent anywhere.
    await owner.put(f"/channels/{cid}/overrides/role/{sid}", {"deny": int(Perm.SEND_MESSAGES)})
    res = await ana.post(f"/messages/{mine['id']}/forward", {"channel_ids": [dm["id"], cid]})
    assert res.status_code == 403
    assert (await bia.get(f"/channels/{dm['id']}/messages")).json() == []
    # At most 5 at once.
    res = await ana.post(f"/messages/{mine['id']}/forward", {"channel_ids": [dm["id"]] * 6})
    assert res.status_code == 422


async def test_forwarded_files_open_in_the_destination(client: AsyncClient) -> None:
    ana, bia, dm = await friends_dm(client)
    owner = await make_user(client, "owner")
    server = await make_server(owner, ana)
    sid, cid = server["id"], text_channel(server)
    image = await uploaded(ana, cid, "foto.png", PNG)
    original = (await ana.post(f"/channels/{cid}/messages", {"attachment_ids": [image["id"]]})).json()

    sent = (await ana.post(f"/messages/{original['id']}/forward", {"channel_ids": [dm["id"]]})).json()
    copy = sent[0]["attachments"][0]
    assert copy["id"] != image["id"] and copy["filename"] == "foto.png"
    # Bia isn't in the server, but the copy in her DM opens.
    assert (await download(bia, image["url"])).status_code == 404
    res = await download(bia, copy["url"])
    assert res.status_code == 200 and res.content == PNG
    # Deleting the original keeps the stored file the copy still uses; deleting both drops it.
    key = f"attachments/{cid}/{image['id']}"
    assert (await ana.delete(f"/messages/{original['id']}")).status_code == 204
    assert await storage.get(key) is not None
    assert (await download(bia, copy["url"])).status_code == 200
    assert (await ana.delete(f"/messages/{sent[0]['id']}")).status_code == 204
    assert await storage.get(key) is None

    # Files need ATTACH_FILES in the destination.
    other = (await ana.post(f"/channels/{dm['id']}/messages", {"attachment_ids": [(await uploaded(ana, dm["id"], "b.png", PNG))["id"]]})).json()
    await owner.put(f"/channels/{cid}/overrides/role/{sid}", {"deny": int(Perm.ATTACH_FILES)})
    assert (await ana.post(f"/messages/{other['id']}/forward", {"channel_ids": [cid]})).status_code == 403


async def test_forward_rate_limit(client: AsyncClient) -> None:
    ana, bia, dm = await friends_dm(client)
    first = (await ana.post(f"/channels/{dm['id']}/messages", {"content": "spam?"})).json()
    for _ in range(20):
        assert (await ana.post(f"/messages/{first['id']}/forward", {"channel_ids": [dm["id"]]})).status_code == 201
    # The 21st in a minute.
    assert (await ana.post(f"/messages/{first['id']}/forward", {"channel_ids": [dm["id"]]})).status_code == 429
