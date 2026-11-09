"""The newest installers, as read from GitHub's release list (block 3.21: the Mac's dmgs too)."""

import httpx
import pytest
from httpx import AsyncClient

from app import releases

BASE = "https://github.com/x/y/releases/download"


def asset(version: str, name: str, size: int = 100) -> dict:
    return {"name": name, "browser_download_url": f"{BASE}/v{version}/{name}", "size": size}


def use_github(monkeypatch: pytest.MonkeyPatch, body: list[dict]) -> None:
    """GitHub's API answering `body` to the release list."""
    real = httpx.AsyncClient

    def client(**kwargs: object) -> httpx.AsyncClient:
        return real(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=body)), **kwargs)

    monkeypatch.setattr(releases.httpx, "AsyncClient", client)


async def test_finds_the_windows_installer_and_both_dmgs(monkeypatch: pytest.MonkeyPatch) -> None:
    use_github(
        monkeypatch,
        [
            {"draft": True, "tag_name": "v0.2.0-beta.11", "assets": [asset("0.2.0-beta.11", "Aureum.Voice.Setup.exe")]},
            {
                "draft": False,
                "tag_name": "v0.2.0-beta.10",
                "assets": [
                    asset("0.2.0-beta.10", "Aureum-Voice-0.2.0-beta.10-arm64.dmg"),
                    asset("0.2.0-beta.10", "Aureum-Voice-0.2.0-beta.10-x64.dmg"),
                    asset("0.2.0-beta.10", "Aureum-Voice-0.2.0-beta.10-arm64-mac.zip"),
                    asset("0.2.0-beta.10", "Aureum.Voice.Setup.0.2.0-beta.10.exe", 95_000_000),
                ],
            },
        ],
    )
    release = await releases._fetch()
    assert release.version == "0.2.0-beta.10"
    assert release.url.endswith("/v0.2.0-beta.10/Aureum.Voice.Setup.0.2.0-beta.10.exe")
    assert release.size_bytes == 95_000_000
    assert release.mac_arm64_url and release.mac_arm64_url.endswith("-arm64.dmg")
    assert release.mac_x64_url and release.mac_x64_url.endswith("-x64.dmg")


async def test_a_windows_only_release_has_no_mac_links(monkeypatch: pytest.MonkeyPatch) -> None:
    use_github(monkeypatch, [{"draft": False, "tag_name": "v0.2.0-beta.9", "assets": [asset("0.2.0-beta.9", "Setup.exe")]}])
    release = await releases._fetch()
    assert release.url.endswith("Setup.exe")
    assert release.mac_arm64_url is None and release.mac_x64_url is None


async def test_the_invite_page_gets_the_mac_links(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def latest() -> releases.Release:
        return releases.Release(url=f"{BASE}/v1/Setup.exe", version="1", mac_arm64_url=f"{BASE}/v1/a-arm64.dmg", mac_x64_url=f"{BASE}/v1/a-x64.dmg")

    monkeypatch.setattr(releases, "latest", latest)
    res = await client.get("/api/app/latest-release")
    assert res.status_code == 200
    assert res.json()["mac_arm64_url"].endswith("-arm64.dmg")
    assert res.json()["mac_x64_url"].endswith("-x64.dmg")
