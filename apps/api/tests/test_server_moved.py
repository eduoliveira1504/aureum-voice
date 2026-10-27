import pytest
from httpx import AsyncClient
from httpx_ws import WebSocketDisconnect, aconnect_ws

from app.config import get_settings
from app.moved import CLOSE_SERVER_MOVED, MOVED_MESSAGE
from tests.helpers import ApiUser, make_user, ws_client
from tests.test_ws import _leaves

NEW = "https://api.new.example"


@pytest.fixture
async def user(client: AsyncClient) -> ApiUser:
    # Made before the switch: the mode is about existing sessions.
    return await make_user(client, "mover")


@pytest.fixture
def moved(monkeypatch: pytest.MonkeyPatch, user: ApiUser) -> None:
    monkeypatch.setattr(get_settings(), "server_moved_to", NEW + "/")


@pytest.mark.usefixtures("moved")
async def test_api_answers_503_with_readable_message(client: AsyncClient, user: ApiUser) -> None:
    for res in (
        await user.get("/users/me"),
        await client.post("/api/auth/login", json={"email": user.email, "password": "whatever-123"}),
        await client.post("/api/auth/refresh", json={"refresh_token": "x"}),
        await client.get("/api/does-not-exist"),
    ):
        assert res.status_code == 503
        assert res.json() == {"detail": MOVED_MESSAGE}


@pytest.mark.usefixtures("moved")
async def test_health_still_answers(client: AsyncClient) -> None:
    res = await client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


@pytest.mark.usefixtures("moved")
async def test_invite_pages_and_assets_redirect_for_good(client: AsyncClient) -> None:
    res = await client.get("/convite/ABC123?ref=mail")
    assert res.status_code == 301
    assert res.headers["location"] == f"{NEW}/convite/ABC123?ref=mail"

    res = await client.get("/static/email/logo.png")
    assert res.status_code == 301
    assert res.headers["location"] == f"{NEW}/static/email/logo.png"


@pytest.mark.usefixtures("moved")
async def test_websocket_closes_with_the_message(user: ApiUser) -> None:
    closes = []
    try:
        async with ws_client() as wsc, aconnect_ws(f"/ws?token={user.token}", wsc) as ws:
            await ws.receive_json()
    except* WebSocketDisconnect as group:
        closes = [(e.code, e.reason) for e in _leaves(group) if isinstance(e, WebSocketDisconnect)]
    assert closes == [(CLOSE_SERVER_MOVED, MOVED_MESSAGE)]


async def test_sessions_survive_the_mode(monkeypatch: pytest.MonkeyPatch, user: ApiUser) -> None:
    monkeypatch.setattr(get_settings(), "server_moved_to", NEW)
    assert (await user.get("/users/me")).status_code == 503
    monkeypatch.setattr(get_settings(), "server_moved_to", "")
    assert (await user.get("/users/me")).status_code == 200
