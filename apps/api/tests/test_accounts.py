import pytest
from httpx import AsyncClient

from app import cli
from app.accounts import RESERVED_USERNAMES
from app.config import get_settings
from tests.test_auth import invite_code, register
from tests.test_badges import held


@pytest.mark.parametrize("username", ["aureum", "Admin", "SUPORTE", "mod", "official"])
async def test_reserved_usernames_cannot_sign_up(client: AsyncClient, username: str) -> None:
    res = await register(client, username=username)
    assert res.status_code == 409
    assert res.json()["detail"] == "This username is reserved"


async def test_the_reserved_list() -> None:
    assert RESERVED_USERNAMES == {
        "aureum", "admin", "administrador", "suporte", "support", "staff", "equipe",
        "sistema", "system", "oficial", "official", "moderador", "mod",
    }


async def test_similar_names_are_fine(client: AsyncClient) -> None:
    assert (await register(client, username="aureum_fan")).status_code == 201


async def test_admin_command_creates_reserved_accounts_without_the_beta_badge(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "aureum_beta", True)
    monkeypatch.setattr(get_settings(), "aureum_owner_username", "edu")
    # @edu signs up first (Founder + Pioneiro #1), then the official account comes from the CLI.
    edu = (await register(client, username="edu", email="edu@example.com")).json()
    assert await cli.create_user("Aureum", "Oficial@Aureum.app", "Aureum", "long-password-1") == 0

    res = await client.post("/api/auth/login", json={"email": "oficial@aureum.app", "password": "long-password-1"})
    assert res.status_code == 200
    me = (await client.get("/api/users/me", headers={"Authorization": f"Bearer {res.json()['access_token']}"})).json()
    assert (me["username"], me["display_name"]) == ("aureum", "Aureum")
    assert held(me) == []
    # The next beta sign-up is #2: the official account took no number.
    code, _ = await invite_code(client)
    ana = await register(client, username="ana", email="ana@example.com", invite_code=code)
    ana_me = await client.get("/api/users/me", headers={"Authorization": f"Bearer {ana.json()['access_token']}"})
    assert held(ana_me.json()) == [("pioneer", 2)]
    assert edu["access_token"]


async def test_admin_command_validation(client: AsyncClient) -> None:
    assert await cli.create_user("support", "s@aureum.app", None, "short") == 2
    assert await cli.create_user("support", "s@aureum.app", None, "long-password-1") == 0
    assert await cli.create_user("SUPPORT", "other@aureum.app", None, "long-password-1") == 1  # taken
    assert await cli.create_user("staff", "s@aureum.app", None, "long-password-1") == 1  # e-mail taken
    with pytest.raises(SystemExit):
        await cli.create_user("no spaces", "x@aureum.app", None, "long-password-1")
    with pytest.raises(SystemExit):
        await cli.create_user("staff", "not-an-email", None, "long-password-1")
