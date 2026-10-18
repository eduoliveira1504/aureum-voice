import base64

from httpx import AsyncClient
from httpx_ws import aconnect_ws

from app import voice
from tests.helpers import make_server, make_user, ws_client
from tests.test_voice import voice_channel
from tests.test_ws import next_event, no_event, ws_url

JPEG = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 64).decode()


def test_thumbnail_validation() -> None:
    assert voice.valid_thumbnail(JPEG)
    png = "data:image/jpeg;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n").decode()
    for bad in (None, 42, "", "data:image/png;base64,AAAA", png, "data:image/jpeg;base64,!!!", JPEG + "A" * 64_000):
        assert not voice.valid_thumbnail(bad), bad


async def test_thumbnails_reach_overview_watchers_only(client: AsyncClient) -> None:
    sharer, watcher, bystander = (
        await make_user(client, "sharer"),
        await make_user(client, "watcher"),
        await make_user(client, "bystander"),
    )
    server = await make_server(sharer, watcher, bystander)
    vid = voice_channel(server)

    async with (
        ws_client() as wsc,
        aconnect_ws(ws_url(sharer), wsc) as sws,
        aconnect_ws(ws_url(watcher), wsc) as wws,
        aconnect_ws(ws_url(bystander), wsc) as bws,
    ):
        for ws in (sws, wws, bws):
            await next_event(ws, "ready")
        await wws.send_json({"type": "overview.watch", "data": {"server_id": server["id"]}})

        # Not sharing yet: refused.
        await sws.send_json({"type": "voice.update", "data": {"channel_id": vid}})
        await next_event(wws, "voice.state")
        await sws.send_json({"type": "screen.thumbnail", "data": {"image": JPEG}})
        await no_event(wws, "screen.thumbnail")

        await sws.send_json({"type": "voice.update", "data": {"channel_id": vid, "screen": True}})
        await next_event(wws, "voice.state")
        await sws.send_json({"type": "screen.thumbnail", "data": {"image": JPEG}})
        event = await next_event(wws, "screen.thumbnail")
        assert event == {"server_id": server["id"], "user_id": sharer.id, "channel_id": vid, "image": JPEG}
        await no_event(bws, "screen.thumbnail")

        # Too soon after the last one: dropped.
        await sws.send_json({"type": "screen.thumbnail", "data": {"image": JPEG}})
        await no_event(wws, "screen.thumbnail")

        # Opening the overview later delivers the latest thumbnail right away.
        await bws.send_json({"type": "overview.watch", "data": {"server_id": server["id"]}})
        assert (await next_event(bws, "screen.thumbnail"))["image"] == JPEG

        # Closing it stops delivery.
        await bws.send_json({"type": "overview.watch", "data": {"server_id": None}})

        # The share ends: watchers drop the card's image, and nothing is kept.
        await sws.send_json({"type": "voice.update", "data": {"channel_id": vid, "screen": False}})
        assert (await next_event(wws, "screen.thumbnail"))["image"] is None
        await no_event(bws, "screen.thumbnail")
        assert await voice.get_thumbnails(server["id"]) == []


async def test_leaving_the_call_drops_the_thumbnail(client: AsyncClient) -> None:
    sharer, watcher = await make_user(client, "sharer"), await make_user(client, "watcher")
    server = await make_server(sharer, watcher)
    vid = voice_channel(server)

    async with ws_client() as wsc, aconnect_ws(ws_url(watcher), wsc) as wws:
        await next_event(wws, "ready")
        await wws.send_json({"type": "overview.watch", "data": {"server_id": server["id"]}})
        async with aconnect_ws(ws_url(sharer), wsc) as sws:
            await next_event(sws, "ready")
            await sws.send_json({"type": "voice.update", "data": {"channel_id": vid, "screen": True}})
            await sws.send_json({"type": "screen.thumbnail", "data": {"image": JPEG}})
            assert (await next_event(wws, "screen.thumbnail"))["image"] == JPEG
        # Disconnecting (last connection) leaves the call. The watch may have been handled after
        # the thumbnail was stored, sending it again as the current one: skip repeats.
        while (image := (await next_event(wws, "screen.thumbnail"))["image"]) == JPEG:
            pass
        assert image is None


async def test_only_members_can_watch(client: AsyncClient) -> None:
    owner, outsider = await make_user(client, "owner"), await make_user(client, "outsider")
    server = await make_server(owner)
    async with ws_client() as wsc, aconnect_ws(ws_url(outsider), wsc) as ws:
        await next_event(ws, "ready")
        await ws.send_json({"type": "overview.watch", "data": {"server_id": server["id"]}})
        assert (await next_event(ws, "error"))["message"] == "Server not found"
        await ws.send_json({"type": "overview.watch", "data": {"server_id": "nope"}})
        assert (await next_event(ws, "error"))["message"] == "Invalid overview.watch payload"
