"""Block 3.11 (part C): GIFs from Klipy (app/gifs.py). The app searches Klipy itself (Klipy's
rules); the API hands it the key, keeps what was sent and the favorites."""

from typing import Any

import pytest
from httpx import AsyncClient
from httpx_ws import aconnect_ws

from app.config import get_settings
from app.permissions import DEFAULT_EVERYONE, Perm
from tests.helpers import ApiUser, make_server, make_user, text_channel, ws_client
from tests.test_calls import friends_dm
from tests.test_ws import next_event, ws_url


def gif(id_: str = "8041071659142944", **change: Any) -> dict[str, Any]:
    return {
        "id": id_,
        "title": "Hello",
        "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/um0L4dFH.mp4",
        "format": "mp4",
        "preview": "https://static1.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/um0L4dFH.webp",
        "width": 498,
        "height": 280,
        **change,
    }


@pytest.fixture
def klipy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "klipy_app_key", "test-klipy-key")


async def send(user: ApiUser, channel_id: str, body: dict[str, Any]):  # noqa: ANN201
    return await user.post(f"/channels/{channel_id}/messages", {"gif": body})


async def test_config_hands_the_key_and_an_anonymous_customer_id(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    off = (await ana.get("/gifs/config")).json()
    assert off["enabled"] is False and off["app_key"] is None and off["customer_id"] is None

    monkeypatch.setattr(get_settings(), "klipy_app_key", "test-klipy-key")
    config = (await ana.get("/gifs/config")).json()
    assert config["enabled"] and config["app_key"] == "test-klipy-key"
    assert (config["content_filter"], config["locale"], config["provider"]) == ("high", "br", "klipy")
    # Stable per user, not their id, different between users.
    assert config["customer_id"] == (await ana.get("/gifs/config")).json()["customer_id"]
    assert ana.id.replace("-", "") not in config["customer_id"]
    assert config["customer_id"] != (await bia.get("/gifs/config")).json()["customer_id"]
    assert (await client.get("/api/gifs/config")).status_code == 401


async def test_a_gif_message(client: AsyncClient, klipy: None) -> None:
    ana, bia, dm = await friends_dm(client)
    server = await make_server(ana, bia)
    cid = text_channel(server)

    res = await send(bia, cid, gif())
    assert res.status_code == 201, res.text
    message = res.json()
    assert message["gif"]["provider"] == "klipy" and message["gif"]["url"] == gif()["url"]
    assert (message["gif"]["width"], message["gif"]["height"]) == (498, 280)
    assert message["content"] == "[GIF: Hello]" and message["link_previews"] == []
    assert (await send(ana, dm["id"], gif())).status_code == 201

    # Only Klipy's media hosts, over https.
    for url in [
        "http://static.klipy.com/x.mp4", "https://evil.example/x.mp4", "https://static.klipy.com.evil.example/x.mp4",
        "https://user@static.klipy.com/x.mp4", "javascript:alert(1)",
    ]:
        assert (await send(ana, cid, gif(url=url))).status_code == 422, url
    assert (await send(ana, cid, gif(preview="https://evil.example/p.webp"))).status_code == 422
    assert (await send(ana, cid, gif(id="../x"))).status_code == 422
    # On its own, and not editable.
    assert (await ana.post(f"/channels/{cid}/messages", {"gif": gif(), "content": "oi"})).status_code == 422
    assert (await bia.patch(f"/messages/{message['id']}", {"content": "x"})).status_code == 400

    reply = await ana.post(f"/channels/{cid}/messages", {"content": "kkk", "reply_to_id": message["id"]})
    assert reply.json()["reply_to"]["media"] == "gif" and reply.json()["reply_to"]["content"] == ""


async def test_in_servers_it_takes_attach_files(client: AsyncClient, klipy: None) -> None:
    ana, bia, dm = await friends_dm(client)
    server = await make_server(ana, bia)
    cid = text_channel(server)
    sent = (await send(ana, cid, gif())).json()
    await ana.patch(f"/roles/{server['id']}", {"permissions": int(DEFAULT_EVERYONE & ~Perm.ATTACH_FILES)})
    assert (await send(bia, cid, gif())).status_code == 403
    # Forwarding one there takes it too; to a DM it goes.
    from_dm = (await send(bia, dm["id"], gif())).json()
    assert (await bia.post(f"/messages/{from_dm['id']}/forward", {"channel_ids": [cid]})).status_code == 403
    forwarded = await bia.post(f"/messages/{sent['id']}/forward", {"channel_ids": [dm["id"]]})
    assert forwarded.status_code == 201 and forwarded.json()[0]["forwarded_from"]["gif"]["id"] == gif()["id"]


async def test_favorites(client: AsyncClient, klipy: None, monkeypatch: pytest.MonkeyPatch) -> None:
    ana = await make_user(client, "ana")
    assert (await ana.get("/gifs/favorites")).json() == []
    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as aws:
        await next_event(aws, "ready")
        assert (await ana.put("/gifs/favorites/1", gif("1"))).status_code == 204
        assert [f["id"] for f in (await next_event(aws, "gifs.favorites"))["favorites"]] == ["1"]
    await ana.put("/gifs/favorites/2", gif("2"))
    await ana.put("/gifs/favorites/1", gif("1"))  # again: no duplicate
    assert [f["id"] for f in (await ana.get("/gifs/favorites")).json()] == ["2", "1"]
    assert (await ana.put("/gifs/favorites/3", gif("4"))).status_code == 422
    assert (await ana.put("/gifs/favorites/3", gif("3", url="https://evil.example/x.mp4"))).status_code == 422

    from app import gifs

    monkeypatch.setattr(gifs, "MAX_FAVORITES", 2)
    assert (await ana.put("/gifs/favorites/3", gif("3"))).status_code == 409
    assert (await ana.delete("/gifs/favorites/1")).status_code == 204
    assert [f["id"] for f in (await ana.get("/gifs/favorites")).json()] == ["2"]
    # Each person's own.
    bia = await make_user(client, "bia")
    assert (await bia.get("/gifs/favorites")).json() == []
