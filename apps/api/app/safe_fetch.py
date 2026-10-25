"""Fetching pages of the open web for someone else (link previews), without reaching inside.

A message's link is chosen by whoever wrote it, so the API must never fetch something on its own
network for them (SSRF): localhost, the Docker network, the home LAN, Tailscale's 100.64/10. Only
public addresses are allowed, checked twice:

- before each request (the first and every redirect), on everything the name resolves to;
- when the socket connects (GuardedBackend), on the address actually used, so a DNS answer that
  changes between the check and the connection (rebinding) can't slip through.

Other limits: http/https only, up to MAX_REDIRECTS redirects, TIMEOUT seconds in all and at most
`max_bytes` read. No proxies from the environment and no cookies.
"""

import asyncio
import ipaddress
import socket
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpcore
import httpx
from httpcore._backends.auto import AutoBackend

TIMEOUT = 5.0
MAX_BYTES = 1024 * 1024
MAX_REDIRECTS = 3
USER_AGENT = "Mozilla/5.0 (compatible; AureumPreview/1.0)"

# Not "global" for Python already, listed so the rule doesn't depend on its version: Tailscale
# and carrier-grade NAT.
SHARED = ipaddress.ip_network("100.64.0.0/10")


class Blocked(Exception):
    """The address isn't one we fetch (internal, not http, too many redirects...)."""


def public_ip(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast and ip not in SHARED


async def _system_getaddrinfo(host: str, port: int) -> list[Any]:
    return await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)


# Tests swap it for a fake DNS.
getaddrinfo = _system_getaddrinfo


async def resolve_public(host: str, port: int) -> list[str]:
    """Every address `host` resolves to, when all of them are public. Raises Blocked otherwise
    (one internal answer is enough: which one gets used isn't up to us)."""
    try:
        infos = await getaddrinfo(host, port)
    except OSError as exc:
        raise Blocked(f"can't resolve {host}") from exc
    addresses = list(dict.fromkeys(str(info[4][0]) for info in infos))
    if not addresses or not all(public_ip(a) for a in addresses):
        raise Blocked(f"{host} isn't a public address")
    return addresses


class GuardedBackend(httpcore.AsyncNetworkBackend):
    """Connects only to public addresses, resolving the name itself. TLS still checks the
    certificate against the name (httpcore passes the request's host as server_hostname)."""

    def __init__(self) -> None:
        self._inner = AutoBackend()

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Any = None,
    ) -> httpcore.AsyncNetworkStream:
        addresses = await resolve_public(host, port)
        return await self._inner.connect_tcp(addresses[0], port, timeout, local_address, socket_options)

    async def connect_unix_socket(self, *args: Any, **kwargs: Any) -> httpcore.AsyncNetworkStream:
        raise Blocked("unix sockets aren't fetched")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


class GuardedTransport(httpx.AsyncHTTPTransport):
    def __init__(self) -> None:
        super().__init__()
        # httpx doesn't take a network backend; its pool (same defaults) does.
        self._pool = httpcore.AsyncConnectionPool(ssl_context=httpx.create_ssl_context(), network_backend=GuardedBackend())


# Tests swap it for an httpx.MockTransport (the checks before each request still apply).
transport_factory: Callable[[], httpx.AsyncBaseTransport] = GuardedTransport


@dataclass
class Fetched:
    url: str  # after redirects
    content_type: str
    charset: str | None
    body: bytes


def _check_url(url: str) -> tuple[str, int]:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise Blocked("only http and https")
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError as exc:
        raise Blocked("bad port") from exc
    return parts.hostname, port


async def fetch(url: str, *, max_bytes: int = MAX_BYTES, accept: str = "*/*") -> Fetched:
    """GETs `url` within the limits above. Raises Blocked for what isn't allowed, and httpx
    errors / TimeoutError for what fails. Answers other than 2xx raise too."""
    async with asyncio.timeout(TIMEOUT), httpx.AsyncClient(
        transport=transport_factory(),
        follow_redirects=False,
        trust_env=False,
        timeout=TIMEOUT,
        headers={"User-Agent": USER_AGENT, "Accept": accept, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5"},
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            await resolve_public(*_check_url(url))
            async with client.stream("GET", url) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise Blocked("redirect without a location")
                    url = urljoin(url, location)
                    continue
                response.raise_for_status()
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body += chunk
                    if len(body) >= max_bytes:
                        del body[max_bytes:]
                        break
                content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                return Fetched(url=str(response.url), content_type=content_type, charset=response.charset_encoding, body=bytes(body))
        raise Blocked("too many redirects")
