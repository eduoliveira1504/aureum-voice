"""Block 3.15: the Painel de sons — each server's own sounds (app/soundboard.py)."""

import asyncio
import io
import math
import struct
import wave
from pathlib import Path

import pytest
from httpx import AsyncClient
from httpx_ws import AsyncWebSocketSession, aconnect_ws

from app.permissions import DEFAULT_EVERYONE, Perm
from tests.helpers import ApiUser, make_server, make_user, ws_client
from tests.test_roles import create_role, give
from tests.test_voice import voice_channel
from tests.test_ws import next_event, ws_url

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


async def join(ws: AsyncWebSocketSession, channel_id: str, **flags: bool) -> None:
    """Sends a voice.update and waits for its own state (moving servers also sends a removal)."""
    await ws.send_json({"type": "voice.update", "data": {"channel_id": channel_id, **flags}})
    while True:
        state = (await next_event(ws, "voice.state"))["state"]
        if state and state["channel_id"] == channel_id and all(state[k] == v for k, v in flags.items()):
            return


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


async def test_playing_needs_the_room_and_the_permissions(client: AsyncClient, livekit_calls: list) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia)
    other = await make_server(bia, name="Outro")
    sid, vid = server["id"], voice_channel(server)
    sound = (await add(ana, sid)).json()
    play = f"/sounds/{sound['id']}/play"

    # Out of voice, or in another server's room: no.
    assert (await bia.post(play)).status_code == 409
    async with ws_client() as wsc, aconnect_ws(ws_url(bia), wsc) as bws:
        await next_event(bws, "ready")
        await join(bws, voice_channel(other))
        assert (await bia.post(play)).status_code == 409

        # In this server's room, with the mic muted by herself: yes.
        await join(bws, vid, muted=True)
        res = await bia.post(play)
        assert res.status_code == 200, res.text
        assert res.json()["duration_ms"] == sound["duration_ms"]

        # Deafened: no.
        await join(bws, vid, deafened=True)
        assert (await bia.post(play)).status_code == 403
        await join(bws, vid)

        # Muted by the server: no.
        assert (await ana.patch(f"/servers/{sid}/members/{bia.id}/voice", {"muted": True})).status_code == 200
        assert (await bia.post(play)).status_code == 403
        assert (await ana.patch(f"/servers/{sid}/members/{bia.id}/voice", {"muted": False})).status_code == 200

        # Without SPEAK or without USE_SOUNDBOARD: no.
        everyone = int(DEFAULT_EVERYONE)
        for missing in (Perm.SPEAK, Perm.USE_SOUNDBOARD):
            assert (await ana.patch(f"/roles/{sid}", {"permissions": everyone & ~missing})).status_code == 200
            assert (await bia.post(play)).status_code == 403
        assert (await ana.patch(f"/roles/{sid}", {"permissions": everyone})).status_code == 200


async def test_one_sound_at_a_time_and_a_cooldown(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia)
    sid, vid = server["id"], voice_channel(server)
    sound = (await add(ana, sid)).json()
    other = (await add(ana, sid, name="sino", data=wav(0.5))).json()

    from app import soundboard

    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as aws, aconnect_ws(ws_url(bia), wsc) as bws:
        for ws in (aws, bws):
            await next_event(ws, "ready")
            await join(ws, vid)

        # 3 s apart at least, whichever sound; each person has their own.
        assert (await ana.post(f"/sounds/{other['id']}/play")).status_code == 200
        busy = await ana.post(f"/sounds/{sound['id']}/play")
        assert busy.status_code == 429 and 1 <= int(busy.headers["retry-after"]) <= 3
        assert (await bia.post(f"/sounds/{sound['id']}/play")).status_code == 200

        # A sound longer than the cooldown holds the lock until it ends.
        monkeypatch.setattr(soundboard, "COOLDOWN_MS", 200)
        await asyncio.sleep(3)
        assert (await ana.post(f"/sounds/{sound['id']}/play")).status_code == 200
        await asyncio.sleep(0.5)
        assert (await ana.post(f"/sounds/{other['id']}/play")).status_code == 429
        await asyncio.sleep(0.8)
        assert (await ana.post(f"/sounds/{other['id']}/play")).status_code == 200


async def test_a_sound_plays_only_in_its_server(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    mine = await make_server(ana, bia)
    other = await make_server(ana, bia, name="Outro")
    sound = (await add(ana, mine["id"])).json()
    async with ws_client() as wsc, aconnect_ws(ws_url(bia), wsc) as bws:
        await next_event(bws, "ready")
        await join(bws, voice_channel(other))
        assert (await bia.post(f"/sounds/{sound['id']}/play")).status_code == 409
    eve = await make_user(client, "eve")
    assert (await eve.post(f"/sounds/{sound['id']}/play")).status_code == 404
