import pytest
from httpx import AsyncClient

from app.config import get_settings
from tests.helpers import ApiUser, make_user
from tests.test_profile import PNG


@pytest.fixture
def owner_named(monkeypatch: pytest.MonkeyPatch):  # noqa: ANN201
    def set_owner(username: str) -> None:
        monkeypatch.setattr(get_settings(), "aureum_owner_username", username)

    return set_owner


async def report(user: ApiUser, description: str = "A tela travou", screenshot: bytes | None = None):  # noqa: ANN201
    files = {"screenshot": ("janela.png", screenshot, "image/png")} if screenshot is not None else None
    return await user.client.post(
        "/api/bug-reports",
        headers=user.headers,
        data={"description": description, "app_version": "0.2.0-beta.1", "os": "Windows_NT 10.0.26200 (x64)",
              "logs": "[info] started"},
        files=files,
    )


async def test_only_the_owner_reads_reports(client: AsyncClient, owner_named) -> None:  # noqa: ANN001
    owner_named("Boss")  # compared in lowercase, like usernames
    boss = await make_user(client, "boss")
    alice = await make_user(client, "alice")
    assert (await boss.get("/users/me")).json()["is_app_owner"] is True
    assert (await alice.get("/users/me")).json()["is_app_owner"] is False

    res = await report(alice, "  Sem áudio na call  ", screenshot=PNG)
    assert res.status_code == 201, res.text
    report_id = res.json()["id"]
    assert (await report(alice)).status_code == 201

    # Everyone else: the screen and the screenshot don't exist.
    assert (await alice.get("/bug-reports")).status_code == 404
    assert (await alice.get(f"/media/bug-reports/{report_id}")).status_code == 404
    assert (await alice.patch(f"/bug-reports/{report_id}", {"resolved": True})).status_code == 404
    # Not under the public media route either.
    assert (await client.get(f"/api/media/bug-reports/{report_id}")).status_code == 401

    reports = (await boss.get("/bug-reports")).json()
    assert [r["description"] for r in reports] == ["A tela travou", "Sem áudio na call"]
    first = reports[1]
    assert first["author"]["username"] == "alice"
    assert (first["app_version"], first["logs"]) == ("0.2.0-beta.1", "[info] started")
    assert first["screenshot_url"] == f"/api/media/bug-reports/{report_id}"
    assert reports[0]["screenshot_url"] is None
    shot = await boss.get(f"/media/bug-reports/{report_id}")
    assert shot.status_code == 200 and shot.content == PNG

    res = await boss.patch(f"/bug-reports/{report_id}", {"resolved": True})
    assert res.status_code == 200 and res.json()["resolved_at"] is not None
    res = await boss.patch(f"/bug-reports/{report_id}", {"resolved": False})
    assert res.json()["resolved_at"] is None


async def test_no_owner_configured_means_nobody_reads(client: AsyncClient) -> None:
    alice = await make_user(client, "alice")
    assert (await alice.get("/users/me")).json()["is_app_owner"] is False
    assert (await alice.get("/bug-reports")).status_code == 404


async def test_report_validation(client: AsyncClient) -> None:
    alice = await make_user(client, "alice")
    assert (await report(alice, "   ")).status_code == 422
    assert (await report(alice, "x" * 2001)).status_code == 422
    assert (await report(alice, screenshot=b"<html>not an image</html>")).status_code == 415
    res = await client.post("/api/bug-reports", data={"description": "oi", "app_version": "1", "os": "x"})
    assert res.status_code == 401


async def test_reports_are_rate_limited(client: AsyncClient) -> None:
    alice = await make_user(client, "alice")
    for _ in range(5):
        assert (await report(alice)).status_code == 201
    assert (await report(alice)).status_code == 429
