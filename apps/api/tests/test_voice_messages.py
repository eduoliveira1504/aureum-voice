"""Voice messages: WebM recordings sent as attachments of kind 'voice', with duration and waveform."""

from typing import Any

from httpx import AsyncClient

from app.permissions import Perm
from tests.helpers import ApiUser, make_server, make_user, text_channel
from tests.test_attachments import MP4, download
from tests.test_calls import friends_dm

WEBM = b"\x1aE\xdf\xa3" + b"\x00" * 64
WAVE = ",".join(str(v) for v in [0, 10, 55, 100, 30])


async def record(user: ApiUser, cid: str, data: bytes = WEBM, **fields: Any) -> Any:
    form = {"voice": "true", "duration_ms": "4200", "waveform": WAVE, **fields}
    return await user.client.post(
        f"/api/channels/{cid}/attachments",
        headers=user.headers,
        data=form,
        files={"file": ("gravacao.webm", data, "audio/webm")},
    )


async def test_send_a_voice_message(client: AsyncClient) -> None:
    owner, member = [await make_user(client, n) for n in ("owner", "member")]
    cid = text_channel(await make_server(owner, member))

    res = await record(owner, cid)
    assert res.status_code == 201, res.text
    voice = res.json()
    assert (voice["kind"], voice["content_type"], voice["filename"]) == ("voice", "audio/webm", "mensagem-de-voz.webm")
    assert (voice["duration_ms"], voice["waveform"]) == (4200, [0, 10, 55, 100, 30])

    sent = await owner.post(f"/channels/{cid}/messages", {"attachment_ids": [voice["id"]]})
    assert sent.status_code == 201, sent.text
    [attached] = sent.json()["attachments"]
    assert (attached["kind"], attached["duration_ms"], attached["waveform"]) == ("voice", 4200, [0, 10, 55, 100, 30])
    # The history carries it the same way, and the file plays for whoever sees the channel.
    [message] = (await member.get(f"/channels/{cid}/messages")).json()
    assert message["attachments"][0]["waveform"] == [0, 10, 55, 100, 30]
    res = await download(member, attached["url"])
    assert res.status_code == 200 and res.content == WEBM
    assert res.headers["content-type"] == "audio/webm"


async def test_voice_message_checks(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    cid = text_channel(await make_server(owner))
    assert (await record(owner, cid, data=MP4)).status_code == 415  # only the recorder's WebM
    assert (await record(owner, cid, duration_ms="0")).status_code == 422
    assert (await record(owner, cid, duration_ms=str(5 * 60 * 1000 + 5000))).status_code == 422  # over 5 min
    assert (await record(owner, cid, waveform="")).status_code == 422
    assert (await record(owner, cid, waveform="1,2,300")).status_code == 422
    assert (await record(owner, cid, waveform=",".join(["5"] * 129))).status_code == 422
    assert (await record(owner, cid, waveform="a,b")).status_code == 422
    # A plain WebM upload stays a video, as before.
    plain = await owner.client.post(
        f"/api/channels/{cid}/attachments", headers=owner.headers, files={"file": ("clip.webm", WEBM, "video/webm")}
    )
    assert plain.json()["kind"] == "video" and plain.json()["duration_ms"] is None


async def test_voice_messages_need_attach_files(client: AsyncClient) -> None:
    owner, member = [await make_user(client, n) for n in ("owner", "member")]
    server = await make_server(owner, member)
    cid, sid = text_channel(server), server["id"]
    assert (await owner.put(f"/channels/{cid}/overrides/role/{sid}", {"deny": int(Perm.ATTACH_FILES)})).status_code == 200
    assert (await record(member, cid)).status_code == 403


async def test_voice_messages_in_dms(client: AsyncClient) -> None:
    ana, _, dm = await friends_dm(client)
    assert (await record(ana, dm["id"])).status_code == 201
