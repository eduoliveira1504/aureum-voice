"""Block 3.22 (part B): a GIF from Klipy as avatar or banner, kept only as a reference (Klipy's
terms forbid storing copies), with the crop the apps apply when drawing it."""

from typing import Any

import pytest
from httpx import AsyncClient

from app import storage
from app.config import get_settings
from tests.helpers import make_user
from tests.test_gifs import gif
from tests.test_image_crop import crop, quadrants, upload

RECT = {"x": 10, "y": 0, "width": 280, "height": 280, "rotate": 0}


@pytest.fixture(autouse=True)
def _klipy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "klipy_app_key", "test-klipy-key")


def body(**change: Any) -> dict[str, Any]:
    return {"gif": gif(), "crop": RECT, **change}


@pytest.mark.parametrize("kind", ["avatar", "banner"])
async def test_a_gif_is_kept_as_a_reference(client: AsyncClient, kind: str) -> None:
    ana = await make_user(client, "ana")
    res = await ana.client.put(f"/api/users/me/{kind}/gif", headers=ana.headers, json=body())
    assert res.status_code == 200, res.text
    me = res.json()
    picked = me[f"{kind}_gif"]
    assert picked["provider"] == "klipy" and picked["id"] == gif()["id"]
    assert picked["url"] == gif()["url"] and picked["crop"] == RECT
    # An MP4 can't play in an <img>: older apps get its still, exactly as Klipy gave it.
    assert me[f"{kind}_url"] == gif()["preview"]
    assert me[f"{kind}_crop"] == RECT
    # Nothing to download: there's no original on our side.
    assert (await ana.client.get(f"/api/users/me/{kind}/original", headers=ana.headers)).status_code == 404

    other = await make_user(client, "bia")
    seen = (await other.client.get(f"/api/users/{ana.id}", headers=other.headers)).json()
    assert seen[f"{kind}_gif"]["url"] == gif()["url"] and seen[f"{kind}_gif"]["crop"] == RECT


async def test_a_webp_shows_itself_to_older_apps(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    webp = gif(url="https://static2.klipy.com/ii/x/y.webp", format="webp")
    res = await ana.client.put("/api/users/me/avatar/gif", headers=ana.headers, json=body(gif=webp))
    assert res.json()["avatar_url"] == webp["url"]


async def test_nothing_goes_to_minio(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    ana = await make_user(client, "ana")
    puts: list[str] = []
    real_put = storage.put

    async def spy(key: str, *args: Any, **kwargs: Any) -> None:
        puts.append(key)
        await real_put(key, *args, **kwargs)

    monkeypatch.setattr(storage, "put", spy)
    assert (await ana.client.put("/api/users/me/avatar/gif", headers=ana.headers, json=body())).status_code == 200
    assert puts == []


async def test_only_klipy_media_and_crops_inside_it(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    path = "/api/users/me/avatar/gif"
    for bad in ("https://evil.example/x.webp", "http://static.klipy.com/x.webp", "https://static.klipy.com.evil.example/x.webp"):
        res = await ana.client.put(path, headers=ana.headers, json=body(gif=gif(url=bad)))
        assert res.status_code == 422, bad
    # 498 x 280: a square of 280 fits from x 0 to 218, and turned it's 280 x 498.
    assert (await ana.client.put(path, headers=ana.headers, json=body(crop={**RECT, "x": 219}))).status_code == 422
    assert (await ana.client.put(path, headers=ana.headers, json=body(crop={**RECT, "y": 1}))).status_code == 422
    turned = {"x": 0, "y": 200, "width": 280, "height": 280, "rotate": 90}
    assert (await ana.client.put(path, headers=ana.headers, json=body(crop=turned))).status_code == 200
    # An MP4 without its still would leave older apps with a broken image.
    assert (await ana.client.put(path, headers=ana.headers, json=body(gif=gif(preview=None)))).status_code == 422


async def test_adjust_and_remove(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    await ana.client.put("/api/users/me/banner/gif", headers=ana.headers, json=body())
    moved = {**RECT, "x": 100, "width": 200, "height": 100}
    res = await ana.client.put("/api/users/me/banner/crop", headers=ana.headers, json=moved)
    assert res.status_code == 200, res.text
    assert res.json()["banner_gif"]["crop"] == moved and res.json()["banner_url"] == gif()["preview"]
    assert (await ana.client.put("/api/users/me/banner/crop", headers=ana.headers, json={**moved, "x": 400})).status_code == 422

    res = await ana.client.delete("/api/users/me/banner", headers=ana.headers)
    assert res.json()["banner_gif"] is None and res.json()["banner_url"] is None


async def test_switching_between_upload_and_gif(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    uploaded = (await upload(ana, "/users/me/avatar", quadrants(), crop(0, 0, 100, 100))).json()
    key = storage.key_from_url(uploaded["avatar_url"])
    assert key and await storage.get(key) is not None

    # The uploaded files go once the GIF replaces them.
    me = (await ana.client.put("/api/users/me/avatar/gif", headers=ana.headers, json=body())).json()
    assert me["avatar_gif"] is not None and await storage.get(key) is None

    # And an upload replaces the GIF as before.
    me = (await upload(ana, "/users/me/avatar", quadrants(), crop(0, 0, 100, 100))).json()
    assert me["avatar_gif"] is None and me["avatar_url"].startswith("/api/media/avatars/")


async def test_gifs_off(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "klipy_app_key", "")
    ana = await make_user(client, "ana")
    assert (await ana.client.put("/api/users/me/avatar/gif", headers=ana.headers, json=body())).status_code == 409
