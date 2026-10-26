"""Block 3.15: the Painel de sons — each server's own sounds (app/soundboard.py)."""

import io
import math
import struct
import wave
from pathlib import Path

import pytest
from httpx import AsyncClient

from app.permissions import DEFAULT_EVERYONE, Perm
from tests.helpers import ApiUser, make_server, make_user
from tests.test_roles import create_role, give

FIXTURES = Path(__file__).parent / "fixtures" / "sounds"


def fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def wav(seconds: float, rate: int = 8000) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = int(seconds * rate)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(i / 8))) for i in range(frames)))
    return out.getvalue()


async def add(  # noqa: ANN201
    user: ApiUser, server_id: str, name: str = "buzina", data: bytes | None = None, filename: str = "s.mp3", **form: str
):
    return await user.client.post(
        f"/api/servers/{server_id}/sounds", headers=user.headers, data={"name": name, **form},
        files={"file": (filename, data or fixture("beep-1s.mp3"), "audio/mpeg")},
    )


def test_everyone_uses_the_soundboard_by_default() -> None:
    assert DEFAULT_EVERYONE & Perm.USE_SOUNDBOARD
    assert not DEFAULT_EVERYONE & Perm.MANAGE_SOUNDBOARD


async def test_sounds_are_managed_with_the_permission(client: AsyncClient) -> None:
    ana, bia, eve = await make_user(client, "ana"), await make_user(client, "bia"), await make_user(client, "eve")
    server = await make_server(ana, bia)
    sid = server["id"]
    assert (await add(bia, sid)).status_code == 403
    assert (await add(eve, sid)).status_code == 404

    res = await add(ana, sid, emoji="📯", volume="70")
    assert res.status_code == 201, res.text
    sound = res.json()
    assert (sound["name"], sound["emoji"], sound["volume"], sound["server_id"]) == ("buzina", "📯", 70, sid)
    assert 1000 <= sound["duration_ms"] <= 1100

    assert [s["id"] for s in (await bia.get(f"/servers/{sid}/sounds")).json()] == [sound["id"]]
    assert (await eve.get(f"/servers/{sid}/sounds")).status_code == 404

    # Only members fetch the file, as uploaded.
    got = await bia.get(f"/media/sounds/{sound['id']}")
    assert got.headers["content-type"] == "audio/mpeg" and got.content == fixture("beep-1s.mp3")
    assert (await eve.get(f"/media/sounds/{sound['id']}")).status_code == 404
    assert (await client.get(f"/api/media/sounds/{sound['id']}")).status_code == 401

    assert (await bia.patch(f"/sounds/{sound['id']}", {"name": "corneta"})).status_code == 403
    manager = await create_role(ana, sid, "DJ", Perm.MANAGE_SOUNDBOARD)
    await give(ana, sid, bia, manager)
    changed = await bia.patch(f"/sounds/{sound['id']}", {"name": "corneta", "emoji": "", "volume": 40})
    assert changed.status_code == 200, changed.text
    assert (changed.json()["name"], changed.json()["emoji"], changed.json()["volume"]) == ("corneta", None, 40)
    assert (await bia.patch(f"/sounds/{sound['id']}", {"emoji": "ab"})).status_code == 422
    assert (await bia.patch(f"/sounds/{sound['id']}", {"volume": 101})).status_code == 422

    assert (await eve.delete(f"/sounds/{sound['id']}")).status_code == 404
    assert (await bia.delete(f"/sounds/{sound['id']}")).status_code == 204
    assert (await ana.get(f"/servers/{sid}/sounds")).json() == []
    assert (await ana.get(f"/media/sounds/{sound['id']}")).status_code == 404


async def test_files_and_limits(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    ana = await make_user(client, "ana")
    sid = (await make_server(ana))["id"]

    # mp3, ogg (Vorbis and Opus) and wav, told apart by their bytes, not the name.
    for name, data, content_type in [
        ("beep-1s.ogg", fixture("beep-1s.ogg"), "audio/ogg"),
        ("beep-1s-opus.ogg", fixture("beep-1s-opus.ogg"), "audio/ogg"),
        ("x.mp3", wav(2), "audio/wav"),
    ]:
        res = await add(ana, sid, data=data, filename=name)
        assert res.status_code == 201, (name, res.text)
        assert (await ana.get(f"/media/sounds/{res.json()['id']}")).headers["content-type"] == content_type

    # Up to 5 s (a hair over is the encoder's padding), measured by the server.
    assert (await add(ana, sid, data=wav(5))).json()["duration_ms"] == 5000
    assert (await add(ana, sid, data=fixture("beep-6s.mp3"))).status_code == 422
    assert (await add(ana, sid, data=wav(5.5))).status_code == 422

    # Not audio, or audio-looking garbage.
    assert (await add(ana, sid, data=b"\x89PNG\r\n\x1a\n" + b"x" * 100)).status_code == 415
    assert (await add(ana, sid, data=b"OggS" + b"\0" * 200)).status_code == 415
    assert (await add(ana, sid, data=b"RIFF\0\0\0\0WAVE" + b"\0" * 64)).status_code == 415
    assert (await add(ana, sid, data=b"ID3" + b"x" * (1024 * 1024))).status_code == 413

    assert (await add(ana, sid, name="x")).status_code == 422
    assert (await add(ana, sid, volume="120")).status_code == 422

    from app import soundboard

    monkeypatch.setattr(soundboard, "MAX_PER_SERVER", 4)  # the four above
    assert (await add(ana, sid)).status_code == 409


async def test_a_servers_sounds_stay_in_it(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    mine = await make_server(ana, bia)
    other = await make_server(bia, name="Outro")
    sound = (await add(ana, mine["id"])).json()
    await add(bia, other["id"], name="sino")

    assert [s["name"] for s in (await bia.get(f"/servers/{mine['id']}/sounds")).json()] == ["buzina"]
    assert [s["name"] for s in (await bia.get(f"/servers/{other['id']}/sounds")).json()] == ["sino"]
    # Leaving the server loses access to its sounds.
    assert (await bia.delete(f"/servers/{mine['id']}/members/me")).status_code in (200, 204)
    assert (await bia.get(f"/media/sounds/{sound['id']}")).status_code == 404


async def test_soundboard_settings(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    res = await ana.patch("/users/me/settings", {"soundboard_volume": 35, "soundboard_muted": True})
    assert res.status_code == 200, res.text
    assert (res.json()["soundboard_volume"], res.json()["soundboard_muted"]) == (35, True)
    assert (await ana.patch("/users/me/settings", {"soundboard_volume": 101})).status_code == 422
