import pytest
from httpx import AsyncClient

from app import cli
from app.accounts import RESERVED_USERNAMES
from tests.test_auth import invited


@pytest.mark.parametrize("username", ["aureum", "Admin", "SUPORTE", "mod", "official"])
async def test_reserved_usernames_cannot_sign_up(client: AsyncClient, username: str) -> None:
    res = await invited(client, username=username)
    assert res.status_code == 409
    assert res.json()["detail"] == "This username is reserved"


async def test_the_reserved_list() -> None:
    assert RESERVED_USERNAMES == {
        "aureum", "admin", "administrador", "suporte", "support", "staff", "equipe",
        "sistema", "system", "oficial", "official", "moderador", "mod",
    }


async def test_similar_names_are_fine(client: AsyncClient) -> None:
    assert (await invited(client, username="aureum_fan")).status_code == 201


async def test_admin_command_creates_reserved_accounts(client: AsyncClient) -> None:
    assert await cli.create_user("Aureum", "Oficial@Aureum.app", display_name="Aureum", password="long-password-1", official=True) == 0
    res = await client.post("/api/auth/login", json={"email": "oficial@aureum.app", "password": "long-password-1"})
    assert res.status_code == 200
    me = (await client.get("/api/users/me", headers={"Authorization": f"Bearer {res.json()['access_token']}"})).json()
    assert (me["username"], me["display_name"], me["is_official"]) == ("aureum", "Aureum", True)


async def test_admin_command_validation(client: AsyncClient) -> None:
    assert await cli.create_user("support", "s@aureum.app", password="short") == 2
    assert await cli.create_user("support", "s@aureum.app", password="long-password-1") == 0
    assert await cli.create_user("SUPPORT", "other@aureum.app", password="long-password-1") == 1  # taken
    assert await cli.create_user("staff", "s@aureum.app", password="long-password-1") == 1  # e-mail taken
    assert await cli.create_user("staff", "x@aureum.app", official=True, pioneer=3) == 2
    with pytest.raises(SystemExit):
        await cli.create_user("no spaces", "x@aureum.app")
    with pytest.raises(SystemExit):
        await cli.create_user("staff", "not-an-email")
