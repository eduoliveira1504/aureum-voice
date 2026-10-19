import pytest
from httpx import AsyncClient

from app import cli
from app.accounts import RESERVED_USERNAMES
from tests.test_auth import invited
from tests.test_onboarding import beta  # noqa: F401  (fixture)


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
    # --oficial means the gold check and the BOT tag too.
    assert (me["is_verified"], me["is_bot"]) == (True, True)


async def _marks(client: AsyncClient, email: str) -> tuple[bool, bool, bool]:
    res = await client.post("/api/auth/login", json={"email": email, "password": "long-password-1"})
    me = (await client.get("/api/users/me", headers={"Authorization": f"Bearer {res.json()['access_token']}"})).json()
    return me["is_official"], me["is_verified"], me["is_bot"]


async def test_regular_accounts_have_neither_check_nor_bot_tag(client: AsyncClient) -> None:
    assert await cli.create_user("ana", "ana@example.com", password="long-password-1") == 0
    assert await _marks(client, "ana@example.com") == (False, False, False)
    res = await invited(client, username="mari")
    assert res.status_code == 201
    me = (await client.get("/api/users/me", headers={"Authorization": f"Bearer {res.json()['access_token']}"})).json()
    assert (me["is_verified"], me["is_bot"]) == (False, False)


async def test_verified_and_bot_flags_on_their_own(client: AsyncClient) -> None:
    assert await cli.create_user("creator", "c@example.com", password="long-password-1", verified=True) == 0
    assert await cli.create_user("helper", "h@example.com", password="long-password-1", bot=True) == 0
    assert await _marks(client, "c@example.com") == (False, True, False)
    assert await _marks(client, "h@example.com") == (False, False, True)


async def test_update_marks_an_existing_account(client: AsyncClient) -> None:
    assert await cli.create_user("aureum", "oficial@aureum.app", password="long-password-1") == 0
    assert await cli.update_user("aureum") == 2  # nothing asked
    assert await cli.update_user("nobody", bot=True) == 1
    assert await cli.update_user("@Aureum", official=True) == 0
    assert await _marks(client, "oficial@aureum.app") == (True, True, True)


async def test_update_never_makes_a_beta_member_official(client: AsyncClient, beta) -> None:  # noqa: ANN001
    assert await cli.create_user("ana", "ana@example.com", password="long-password-1", confirmed=True) == 0
    assert await cli.update_user("ana", official=True) == 1  # holds Pioneiro and invites
    assert await cli.update_user("ana", verified=True) == 0
    assert await _marks(client, "ana@example.com") == (False, True, False)


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
