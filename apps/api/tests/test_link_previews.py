"""Block 3.11 (part B): link previews (app/link_previews.py) and the guarded fetch behind them
(app/safe_fetch.py). Sites are an httpx.MockTransport and DNS a table, so nothing leaves the
machine; the address checks run as they do for real."""

import asyncio
import io
import socket
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx
import pytest
from httpx import AsyncClient
from httpx_ws import aconnect_ws
from PIL import Image

from app import link_previews, safe_fetch
from app.config import get_settings
from app.realtime import broker
from tests.helpers import ApiUser, make_server, make_user, text_channel, ws_client
from tests.test_reads import say
from tests.test_ws import next_event, ws_url

DNS = {
    "example.com": "93.184.216.34",
    "www.youtube.com": "142.250.79.46",
    "i.ytimg.com": "142.250.79.86",
    "cdn.example.com": "93.184.216.35",
    "inside.example.com": "10.0.0.5",
    "tailnet.example.com": "100.101.102.103",
    "localhost": "127.0.0.1",
}


def png(width: int = 1200, height: int = 630) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), (232, 181, 49)).save(out, "PNG")
    return out.getvalue()


PAGE = """<!doctype html><html><head>
<meta charset="utf-8"><title>Fallback</title>
<meta property="og:site_name" content="Exemplo">
<meta property="og:title" content="Um título &amp; tanto">
<meta property="og:description" content="Descrição   do   post">
<meta property="og:image" content="/capa.png">
</head><body><p>texto</p></body></html>"""

Handler = Callable[[httpx.Request], Any]


class Sites:
    """The fake web: path handlers by host, and every request seen."""

    def __init__(self) -> None:
        self.routes: dict[str, Handler] = {}
        self.seen: list[str] = []

    def __call__(self, url: str, handler: Handler) -> None:
        self.routes[url] = handler

    async def handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url.copy_with(query=None))
        self.seen.append(str(request.url))
        handler = self.routes.get(url)
        if handler is None:
            return httpx.Response(404)
        result = handler(request)
        if asyncio.iscoroutine(result):
            result = await result
        return result


@pytest.fixture
async def sites(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[Sites]:
    fake = Sites()

    async def resolve(host: str, port: int) -> list[Any]:
        if host.replace(".", "").isdigit() or ":" in host:  # an address, as the system answers
            return [(socket.AF_INET6 if ":" in host else socket.AF_INET, socket.SOCK_STREAM, 6, "", (host, port))]
        if host not in DNS:
            raise socket.gaierror("unknown")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (DNS[host], port))]

    monkeypatch.setattr(safe_fetch, "getaddrinfo", resolve)
    monkeypatch.setattr(safe_fetch, "transport_factory", lambda: httpx.MockTransport(fake.handle))
    async for key in broker.redis.scan_iter(match=f"{get_settings().redis_prefix}:lp:*"):
        await broker.redis.delete(key)
    yield fake
    await link_previews.settle()


def html(body: str = PAGE) -> Handler:
    return lambda _: httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, text=body)


def image(data: bytes | None = None) -> Handler:
    return lambda _: httpx.Response(200, headers={"content-type": "image/png"}, content=data or png())


def redirect(to: str) -> Handler:
    return lambda _: httpx.Response(302, headers={"location": to})


async def history(user: ApiUser, channel_id: str) -> list[dict[str, Any]]:
    return (await user.get(f"/channels/{channel_id}/messages")).json()


# --- Rules -----------------------------------------------------------------------------------


def test_which_links_get_a_card() -> None:
    text = "veja https://a.com/x, e https://b.com/y. <https://c.com> https://a.com/x https://d.com https://e.com"
    assert link_previews.links(text) == ["https://a.com/x", "https://b.com/y", "https://d.com"]
    assert link_previews.links("(https://a.com/página)!") == ["https://a.com/página"]
    assert link_previews.links("sem link aqui, ftp://a.com") == []


def test_public_addresses_only() -> None:
    for internal in [
        "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "100.64.0.1",
        "100.127.255.254", "169.254.169.254", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1",
        "::ffff:127.0.0.1", "::ffff:10.0.0.1", "nonsense",
    ]:
        assert not safe_fetch.public_ip(internal), internal
    for public in ["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111"]:
        assert safe_fetch.public_ip(public), public


def test_reading_a_page() -> None:
    page = link_previews.parse_page(PAGE, "https://example.com/post/1")
    assert page == {
        "site": "Exemplo",
        "title": "Um título & tanto",
        "description": "Descrição do post",
        "image_source": "https://example.com/capa.png",
    }
    plain = link_previews.parse_page("<html><head><title> Só o título </title></head></html>", "https://www.site.com.br/")
    assert plain == {"site": "site.com.br", "title": "Só o título", "description": None, "image_source": None}
    assert link_previews.parse_page("<html><body>nada</body></html>", "https://a.com") is None


# --- Guarded fetch ---------------------------------------------------------------------------


async def test_internal_addresses_are_refused(sites: Sites) -> None:
    for url in [
        "http://127.0.0.1/", "http://localhost:8000/api/health", "http://10.0.0.1/", "http://[::1]/",
        "https://inside.example.com/", "https://tailnet.example.com/", "file:///etc/passwd", "ftp://example.com/",
    ]:
        with pytest.raises(safe_fetch.Blocked):
            await safe_fetch.fetch(url)
    assert sites.seen == []


async def test_redirects_are_checked_each_time(sites: Sites) -> None:
    sites("https://example.com/vai", redirect("http://169.254.169.254/latest/meta-data"))
    sites("https://example.com/dns", redirect("https://inside.example.com/admin"))
    for url in ["https://example.com/vai", "https://example.com/dns"]:
        with pytest.raises(safe_fetch.Blocked):
            await safe_fetch.fetch(url)
    assert all("169.254" not in u and "inside" not in u for u in sites.seen)

    for i in range(4):
        sites(f"https://example.com/r{i}", redirect(f"/r{i + 1}"))
    sites("https://example.com/r4", html())
    with pytest.raises(safe_fetch.Blocked, match="too many redirects"):
        await safe_fetch.fetch("https://example.com/r0")
    assert (await safe_fetch.fetch("https://example.com/r1")).url == "https://example.com/r4"


async def test_the_connection_itself_is_checked() -> None:
    """The socket's address is checked too (DNS that changes after the first check)."""
    with pytest.raises(safe_fetch.Blocked):
        await safe_fetch.GuardedBackend().connect_tcp("127.0.0.1", 80)


async def test_time_and_size_limits(sites: Sites, monkeypatch: pytest.MonkeyPatch) -> None:
    async def slow(_: httpx.Request) -> httpx.Response:
        await asyncio.sleep(5)
        return httpx.Response(200)

    sites("https://example.com/lento", slow)
    sites("https://example.com/grande", lambda _: httpx.Response(200, content=b"x" * (3 * 1024 * 1024)))
    monkeypatch.setattr(safe_fetch, "TIMEOUT", 0.2)
    with pytest.raises(TimeoutError):
        await safe_fetch.fetch("https://example.com/lento")
    assert len((await safe_fetch.fetch("https://example.com/grande")).body) == safe_fetch.MAX_BYTES


# --- In messages -----------------------------------------------------------------------------


async def test_a_message_gets_its_card_live(client: AsyncClient, sites: Sites) -> None:
    sites("https://example.com/post", html())
    sites("https://example.com/capa.png", image())
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia)
    cid = text_channel(server)

    async with ws_client() as wsc, aconnect_ws(ws_url(bia), wsc) as bws:
        await next_event(bws, "ready")
        sent = await say(ana, cid, "olha https://example.com/post")
        assert sent["link_previews"] == []  # sending doesn't wait for the site
        updated = await next_event(bws, "message.updated")
    assert updated["id"] == sent["id"] and updated["edited_at"] is None
    [card] = updated["link_previews"]
    assert card["kind"] == "link" and card["site"] == "Exemplo" and card["title"] == "Um título & tanto"
    assert card["image"].startswith("/api/media/previews/") and (card["image_width"], card["image_height"]) == (640, 336)
    assert (await history(bia, cid))[-1]["link_previews"] == [card]

    served = await client.get(card["image"])
    assert served.status_code == 200 and served.headers["content-type"] == "image/webp"

    # Cached: the same link elsewhere doesn't fetch again.
    before = len(sites.seen)
    await say(bia, cid, "https://example.com/post de novo")
    await link_previews.settle()
    assert len(sites.seen) == before
    assert (await history(bia, cid))[-1]["link_previews"] == [card]


async def test_youtube(client: AsyncClient, sites: Sites) -> None:
    oembed = {"title": "Clipe novo", "author_name": "Canal do Fulano", "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"}
    sites("https://www.youtube.com/oembed", lambda _: httpx.Response(200, json=oembed))
    sites("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", image(png(480, 360)))
    ana = await make_user(client, "ana")
    cid = text_channel(await make_server(ana))
    await say(ana, cid, "https://youtu.be/dQw4w9WgXcQ?t=42")
    await link_previews.settle()
    [card] = (await history(ana, cid))[-1]["link_previews"]
    assert card["kind"] == "youtube" and card["video_id"] == "dQw4w9WgXcQ"
    assert (card["title"], card["channel"], card["site"]) == ("Clipe novo", "Canal do Fulano", "YouTube")
    assert card["url"] == "https://youtu.be/dQw4w9WgXcQ?t=42" and card["image"]
    assert any("oembed" in u and "dQw4w9WgXcQ" in u for u in sites.seen)


async def test_no_card_for_internal_links_or_between_brackets(client: AsyncClient, sites: Sites) -> None:
    sites("https://example.com/post", html())
    sites("https://example.com/vai", redirect("http://192.168.0.1/"))
    ana = await make_user(client, "ana")
    cid = text_channel(await make_server(ana))
    for text in ["http://localhost:8000/api/health", "https://example.com/vai", "<https://example.com/post>"]:
        await say(ana, cid, text)
    await link_previews.settle()
    assert all(m["link_previews"] == [] for m in await history(ana, cid))
    assert not any("192.168" in u for u in sites.seen)


async def test_removing_cards_and_editing(client: AsyncClient, sites: Sites) -> None:
    sites("https://example.com/post", html())
    sites("https://example.com/outro", html(PAGE.replace("Um título &amp; tanto", "Outro")))
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia)
    cid = text_channel(server)
    sent = await say(ana, cid, "https://example.com/post")
    await link_previews.settle()

    # Editing to another link swaps the card.
    await ana.patch(f"/messages/{sent['id']}", {"content": "na verdade https://example.com/outro"})
    await link_previews.settle()
    assert [c["title"] for c in (await history(ana, cid))[-1]["link_previews"]] == ["Outro"]

    assert (await bia.delete(f"/messages/{sent['id']}/previews")).status_code == 403
    res = await ana.delete(f"/messages/{sent['id']}/previews")
    assert res.status_code == 200 and res.json()["link_previews"] == []
    # Removed stays removed, even with a new link.
    await ana.patch(f"/messages/{sent['id']}", {"content": "https://example.com/post"})
    await link_previews.settle()
    assert (await history(ana, cid))[-1]["link_previews"] == []


async def test_a_forward_keeps_the_card(client: AsyncClient, sites: Sites) -> None:
    sites("https://example.com/post", html())
    ana = await make_user(client, "ana")
    server = await make_server(ana)
    cid = text_channel(server)
    other = (await ana.post(f"/servers/{server['id']}/channels", {"name": "outro"})).json()["id"]
    sent = await say(ana, cid, "https://example.com/post")
    await link_previews.settle()
    card = (await history(ana, cid))[-1]["link_previews"]
    assert card

    sites.seen.clear()
    res = await ana.post(f"/messages/{sent['id']}/forward", {"channel_ids": [other], "comment": ""})
    assert res.status_code == 201 and res.json()[0]["link_previews"] == card
    await link_previews.settle()
    assert sites.seen == []
