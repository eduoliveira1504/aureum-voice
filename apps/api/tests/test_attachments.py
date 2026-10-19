"""Files in conversations: upload, send, download with permission checks, limits and cleanup."""

from typing import Any

import pytest
from httpx import AsyncClient
from httpx_ws import aconnect_ws

from app import storage
from app.config import get_settings
from app.permissions import Perm
from tests.helpers import ApiUser, make_server, make_user, text_channel, ws_client
from tests.test_calls import friends_dm
from tests.test_profile import PNG
from tests.test_ws import next_event, ws_url

MP4 = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 64
HTML = b"<html><script>alert(1)</script></html>"


async def upload(user: ApiUser, cid: str, name: str, data: bytes, type_: str = "application/octet-stream") -> Any:
    return await user.client.post(f"/api/channels/{cid}/attachments", headers=user.headers, files={"file": (name, data, type_)})


async def uploaded(user: ApiUser, cid: str, name: str, data: bytes, type_: str = "application/octet-stream") -> dict[str, Any]:
    res = await upload(user, cid, name, data, type_)
    assert res.status_code == 201, res.text
    return res.json()


async def download(user: ApiUser, url: str) -> Any:
    return await user.client.get(url, headers=user.headers)


async def test_send_and_download_files(client: AsyncClient) -> None:
    owner, member, outsider = [await make_user(client, n) for n in ("owner", "member", "outsider")]
    cid = text_channel(await make_server(owner, member))

    image = await uploaded(owner, cid, "foto.png", PNG, "image/png")
    video = await uploaded(owner, cid, "clipe.mp4", MP4, "video/mp4")
    # The client's claimed type is ignored: a page is just a file to download.
    page = await uploaded(owner, cid, "../../evil<>.html", HTML, "text/html")
    assert (image["kind"], image["content_type"], image["size"]) == ("image", "image/png", len(PNG))
    assert (video["kind"], video["content_type"]) == ("video", "video/mp4")
    assert (page["kind"], page["content_type"], page["filename"]) == ("file", "application/octet-stream", "evil__.html")

    # Until it's sent, only the uploader can fetch it.
    assert (await download(owner, image["url"])).status_code == 200
    assert (await download(member, image["url"])).status_code == 404

    async with ws_client() as wsc, aconnect_ws(ws_url(member), wsc) as ws:
        await next_event(ws, "ready")
        res = await owner.post(f"/channels/{cid}/messages", {"attachment_ids": [video["id"], image["id"], page["id"]]})
        assert res.status_code == 201, res.text
        assert res.json()["content"] == ""
        event = await next_event(ws, "message.created")
    assert [a["filename"] for a in event["attachments"]] == ["clipe.mp4", "foto.png", "evil__.html"]
    history = (await member.get(f"/channels/{cid}/messages")).json()
    assert history[-1]["attachments"] == event["attachments"]

    res = await download(member, image["url"])
    assert res.status_code == 200 and res.content == PNG
    assert res.headers["content-type"] == "image/png"
    assert res.headers["content-disposition"] == "inline; filename*=UTF-8''foto.png"
    res = await download(member, page["url"])
    assert res.headers["content-type"] == "application/octet-stream"
    assert res.headers["content-disposition"].startswith("attachment;")
    assert res.headers["content-security-policy"] == "sandbox"
    # Not for strangers, nor without a token.
    assert (await download(outsider, image["url"])).status_code == 404
    assert (await client.get(image["url"])).status_code == 401

    # A file can only be sent once.
    res = await owner.post(f"/channels/{cid}/messages", {"content": "de novo", "attachment_ids": [image["id"]]})
    assert res.status_code == 422


async def test_files_follow_channel_permissions(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    server = await make_server(owner, member)
    sid, cid = server["id"], text_channel(server)

    image = await uploaded(owner, cid, "a.png", PNG)
    await owner.post(f"/channels/{cid}/messages", {"attachment_ids": [image["id"]]})
    assert (await download(member, image["url"])).status_code == 200
    # Who can't see the channel anymore can't download its files either.
    assert (await owner.put(f"/channels/{cid}/overrides/role/{sid}", {"deny": int(Perm.VIEW_CHANNEL)})).status_code == 200
    assert (await download(member, image["url"])).status_code == 404
    assert (await owner.delete(f"/channels/{cid}/overrides/role/{sid}")).status_code == 200

    # Sending files takes ATTACH_FILES (and SEND_MESSAGES).
    assert (await owner.put(f"/channels/{cid}/overrides/role/{sid}", {"deny": int(Perm.ATTACH_FILES)})).status_code == 200
    assert (await upload(member, cid, "b.png", PNG)).status_code == 403
    assert (await member.post(f"/channels/{cid}/messages", {"content": "texto ainda vai"})).status_code == 201

    assert (await owner.delete(f"/channels/{cid}/overrides/role/{sid}")).status_code == 200

    # Someone else's upload, or one for another channel, can't be attached.
    other = (await owner.post(f"/servers/{sid}/channels", {"name": "outro"})).json()["id"]
    theirs = await uploaded(owner, cid, "c.png", PNG)
    elsewhere = await uploaded(owner, other, "d.png", PNG)
    assert (await member.post(f"/channels/{cid}/messages", {"attachment_ids": [theirs["id"]]})).status_code == 422
    assert (await owner.post(f"/channels/{cid}/messages", {"attachment_ids": [elsewhere["id"]]})).status_code == 422
    # A message needs text or a file.
    assert (await owner.post(f"/channels/{cid}/messages", {"content": "  "})).status_code == 422


async def test_size_limit(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    owner = await make_user(client, "owner")
    cid = text_channel(await make_server(owner))
    monkeypatch.setattr(get_settings(), "max_attachment_mb", 1)
    assert (await upload(owner, cid, "big.bin", b"x" * (1024 * 1024 + 1))).status_code == 413
    assert (await upload(owner, cid, "ok.bin", b"x" * (1024 * 1024))).status_code == 201
    assert (await upload(owner, cid, "empty.bin", b"")).status_code == 422


async def test_files_in_dms(client: AsyncClient) -> None:
    ana, bia, dm = await friends_dm(client)
    stranger = await make_user(client, "stranger")
    image = await uploaded(ana, dm["id"], "nós.png", PNG)
    res = await ana.post(f"/channels/{dm['id']}/messages", {"content": "olha", "attachment_ids": [image["id"]]})
    assert res.status_code == 201
    res = await download(bia, image["url"])
    assert res.status_code == 200 and res.headers["content-disposition"] == "inline; filename*=UTF-8''n%C3%B3s.png"
    assert (await download(stranger, image["url"])).status_code == 404
    assert (await upload(stranger, dm["id"], "x.png", PNG)).status_code == 404


async def test_deleting_removes_the_files(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    server = await make_server(owner)
    cid = text_channel(server)
    key = lambda a: a["url"].rsplit("/", 1)[-1]  # noqa: E731

    first = await uploaded(owner, cid, "a.png", PNG)
    message = (await owner.post(f"/channels/{cid}/messages", {"attachment_ids": [first["id"]]})).json()
    assert await storage.get(f"attachments/{cid}/{key(first)}") is not None
    assert (await owner.delete(f"/messages/{message['id']}")).status_code == 204
    assert await storage.get(f"attachments/{cid}/{key(first)}") is None
    assert (await download(owner, first["url"])).status_code == 404

    # Deleting the channel takes its files along, sent or not.
    pending = await uploaded(owner, cid, "b.png", PNG)
    assert (await owner.delete(f"/channels/{cid}")).status_code == 204
    assert await storage.get(f"attachments/{cid}/{key(pending)}") is None
