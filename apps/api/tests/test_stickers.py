"""Block 3.11 (part C): stickers — Aureum's packs (CLI, usable everywhere) and each server's own
(app/stickers.py)."""

import io
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from PIL import Image

from app import cli
from app.permissions import DEFAULT_EVERYONE, Perm
from tests.helpers import ApiUser, make_server, make_user, text_channel
from tests.test_calls import friends_dm


def image(width: int = 200, height: int = 200, fmt: str = "PNG", frames: int = 1) -> bytes:
    out = io.BytesIO()
    first = Image.new("RGBA", (width, height), (232, 181, 49, 255))
    if frames > 1:
        rest = [Image.new("RGBA", (width, height), (i * 40, 0, 0, 255)) for i in range(1, frames)]
        first.save(out, fmt, save_all=True, append_images=rest)
    else:
        first.save(out, fmt)
    return out.getvalue()


async def add(user: ApiUser, server_id: str, name: str = "kkkk", data: bytes | None = None, emoji: str | None = "😂"):  # noqa: ANN201
    form = {"name": name, **({"emoji": emoji} if emoji else {})}
    return await user.client.post(
        f"/api/servers/{server_id}/stickers", headers=user.headers, data=form,
        files={"file": ("s.png", data or image(), "image/png")},
    )


async def send(user: ApiUser, channel_id: str, sticker_id: str):  # noqa: ANN201
    return await user.post(f"/channels/{channel_id}/messages", {"sticker_id": sticker_id})


async def aureum_pack(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    (tmp_path / "bom_dia.png").write_bytes(image())
    (tmp_path / "gg.png").write_bytes(image(400, 200))
    (tmp_path / "stickers.json").write_text('{"bom_dia": {"emoji": "☀️"}}', encoding="utf-8")
    assert await cli.stickers_pack_add("Aureum básico", str(tmp_path)) == 0
    assert "2 stickers" in capsys.readouterr().out


async def packs(user: ApiUser) -> list[dict[str, Any]]:
    res = await user.get("/stickers")
    assert res.status_code == 200, res.text
    return res.json()


def test_everyone_uses_stickers_by_default() -> None:
    assert DEFAULT_EVERYONE & Perm.USE_STICKERS
    assert not DEFAULT_EVERYONE & Perm.MANAGE_EXPRESSIONS


async def test_server_stickers_are_managed_with_the_permission(client: AsyncClient) -> None:
    ana, bia, eve = await make_user(client, "ana"), await make_user(client, "bia"), await make_user(client, "eve")
    server = await make_server(ana, bia)
    sid = server["id"]
    assert (await add(bia, sid)).status_code == 403
    assert (await add(eve, sid)).status_code == 404

    res = await add(ana, sid, data=image(640, 480))
    assert res.status_code == 201, res.text
    sticker = res.json()
    # Scaled down to fit 320x320, kept as WebP.
    assert (sticker["name"], sticker["emoji"], sticker["width"], sticker["height"]) == ("kkkk", "😂", 320, 240)

    [pack] = await packs(bia)
    assert pack["server_id"] == sid and not pack["is_global"] and [s["id"] for s in pack["stickers"]] == [sticker["id"]]
    assert await packs(eve) == []

    # Only members fetch the file.
    assert (await bia.get(f"/media/stickers/{sticker['id']}")).headers["content-type"] == "image/webp"
    assert (await eve.get(f"/media/stickers/{sticker['id']}")).status_code == 404
    assert (await client.get(f"/api/media/stickers/{sticker['id']}")).status_code == 401

    assert (await bia.patch(f"/stickers/{sticker['id']}", {"name": "rindo"})).status_code == 403
    renamed = await ana.patch(f"/stickers/{sticker['id']}", {"name": "rindo", "emoji": "🤣"})
    assert renamed.json()["name"] == "rindo" and renamed.json()["emoji"] == "🤣"
    assert (await ana.patch(f"/stickers/{sticker['id']}", {"emoji": "ab"})).status_code == 422


async def test_files_and_limits(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    ana = await make_user(client, "ana")
    sid = (await make_server(ana))["id"]
    gif = io.BytesIO()
    Image.new("RGB", (10, 10)).save(gif, "GIF")
    assert (await add(ana, sid, data=gif.getvalue())).status_code == 415
    assert (await add(ana, sid, data=image(fmt="WEBP", frames=3))).status_code == 415
    assert (await add(ana, sid, data=b"\x89PNG\r\n\x1a\n" + b"x" * 600 * 1024)).status_code == 413
    assert (await add(ana, sid, data=image(fmt="WEBP"))).status_code == 201
    assert (await add(ana, sid, name="x")).status_code == 422

    from app import stickers

    monkeypatch.setattr(stickers, "MAX_PER_SERVER", 2)
    assert (await add(ana, sid)).status_code == 201
    assert (await add(ana, sid)).status_code == 409


async def test_a_servers_sticker_only_goes_in_that_server(client: AsyncClient) -> None:
    ana, bia, dm = await friends_dm(client)
    server = await make_server(ana, bia)
    other = await make_server(ana, name="Outro")
    cid, other_cid = text_channel(server), text_channel(other)
    sticker = (await add(ana, server["id"])).json()

    res = await send(bia, cid, sticker["id"])
    assert res.status_code == 201, res.text
    message = res.json()
    assert message["sticker"]["id"] == sticker["id"] and message["sticker"]["server_id"] == server["id"]
    assert message["content"] == "[Figurinha: kkkk]"  # older apps show this

    assert (await send(ana, other_cid, sticker["id"])).status_code == 403
    assert (await send(ana, dm["id"], sticker["id"])).status_code == 403
    # Text and files don't go with it; it can't be edited.
    assert (await ana.post(f"/channels/{cid}/messages", {"sticker_id": sticker["id"], "content": "oi"})).status_code == 422
    assert (await bia.patch(f"/messages/{message['id']}", {"content": "x"})).status_code == 400

    # Forwarding: inside the server yes, out of it no.
    second = (await ana.post(f"/servers/{server['id']}/channels", {"name": "memes"})).json()["id"]
    assert (await bia.post(f"/messages/{message['id']}/forward", {"channel_ids": [second]})).status_code == 201
    assert (await bia.post(f"/messages/{message['id']}/forward", {"channel_ids": [dm["id"]]})).status_code == 403

    # A reply quotes it as a sticker.
    reply = await ana.post(f"/channels/{cid}/messages", {"content": "kkk", "reply_to_id": message["id"]})
    assert reply.json()["reply_to"]["media"] == "sticker" and reply.json()["reply_to"]["content"] == ""

    # Removed: the message keeps what it was, the file is gone.
    assert (await ana.delete(f"/stickers/{sticker['id']}")).status_code == 204
    kept = (await ana.get(f"/channels/{cid}/messages")).json()
    assert any(m["sticker"] and m["sticker"]["name"] == "kkkk" for m in kept)
    assert (await ana.get(f"/media/stickers/{sticker['id']}")).status_code == 404


async def test_use_stickers_permission(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia)
    cid = text_channel(server)
    sticker = (await add(ana, server["id"])).json()
    await ana.patch(f"/roles/{server['id']}", {"permissions": int(DEFAULT_EVERYONE & ~Perm.USE_STICKERS)})
    assert (await send(bia, cid, sticker["id"])).status_code == 403
    assert (await send(ana, cid, sticker["id"])).status_code == 201  # the owner has everything


async def test_aureum_packs_work_everywhere(client: AsyncClient, tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    await aureum_pack(tmp_path, capsys)
    ana, bia, dm = await friends_dm(client)
    eve = await make_user(client, "eve")
    [pack] = await packs(eve)
    assert pack["is_global"] and pack["name"] == "Aureum básico"
    assert [(s["name"], s["emoji"]) for s in pack["stickers"]] == [("bom dia", "☀️"), ("gg", None)]
    first = pack["stickers"][0]
    assert (await eve.get(f"/media/stickers/{first['id']}")).status_code == 200

    server = await make_server(eve)
    assert (await send(eve, text_channel(server), first["id"])).status_code == 201
    sent = await send(ana, dm["id"], first["id"])
    assert sent.status_code == 201 and sent.json()["sticker"]["server_id"] is None
    group = (await ana.post("/dms/groups", {"user_ids": [bia.id]})).json()
    assert (await ana.post(f"/messages/{sent.json()['id']}/forward", {"channel_ids": [group["id"]]})).status_code == 201

    # Aureum's are changed only by the CLI.
    assert (await ana.patch(f"/stickers/{first['id']}", {"name": "oi"})).status_code == 403
    assert (await ana.delete(f"/stickers/{first['id']}")).status_code == 403

    assert await cli.stickers_sticker_add(pack["id"], "valeu", str(tmp_path / "gg.png"), "🙏") == 0
    assert [s["name"] for s in (await packs(eve))[0]["stickers"]] == ["bom dia", "gg", "valeu"]
    assert await cli.stickers_list() == 0
    assert "valeu" in capsys.readouterr().out


async def test_recent_stickers_in_settings(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    res = await ana.patch("/users/me/settings", {"recent_stickers": ["8a3c1f6e-0000-4000-8000-000000000001"]})
    assert res.json()["recent_stickers"] == ["8a3c1f6e-0000-4000-8000-000000000001"]


async def test_the_aureum_basic_pack_imports(client: AsyncClient, capsys: pytest.CaptureFixture[str]) -> None:
    """The pack shipped in app/static (scripts/build-stickers.mjs) goes in with the CLI as is."""
    folder = Path(cli.__file__).parent / "static" / "stickers" / "aureum-basico"
    assert await cli.stickers_pack_add("Aureum básico", str(folder)) == 0
    assert "16 stickers" in capsys.readouterr().out
    ana = await make_user(client, "ana")
    [pack] = await packs(ana)
    names = {s["name"]: s for s in pack["stickers"]}
    assert {"bom dia", "kkkk", "gg", "tô dentro", "boa noite"} <= names.keys()
    assert names["kkkk"]["emoji"] == "😂" and (names["kkkk"]["width"], names["kkkk"]["height"]) == (320, 320)
