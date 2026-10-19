import uuid

from httpx import AsyncClient

from app.config import get_settings
from app.security import create_token
from tests.helpers import PASSWORD, make_account_invite, make_server, make_user

USER = {"username": "Edu", "email": "Edu@Example.com", "password": "correct-horse-1"}


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def register(client: AsyncClient, **fields: str):  # noqa: ANN201
    return await client.post("/api/auth/register", json={**USER, **fields})


async def invited(client: AsyncClient, **fields: str):  # noqa: ANN201
    """Signs up with a fresh account invite (as the CLI makes them)."""
    return await register(client, invite_code=await make_account_invite(), **fields)


async def invite_code(client: AsyncClient, **options: int) -> tuple[str, dict]:
    """A server invite: an owner with a server hands one out (the owner is created in the DB)."""
    owner = await make_user(client, f"owner{uuid.uuid4().hex[:6]}")
    server = await make_server(owner)
    res = await owner.post(f"/servers/{server['id']}/invites", options)
    return res.json()["code"], server


# --- Sign-up ------------------------------------------------------------------


async def test_sign_up_with_an_account_invite_normalizes_fields(client: AsyncClient) -> None:
    res = await invited(client)
    assert res.status_code == 201, res.text
    me = (await client.get("/api/users/me", headers=bearer(res.json()["access_token"]))).json()
    assert (me["username"], me["email"], me["display_name"]) == ("edu", "edu@example.com", "edu")
    assert (me["email_verified"], me["must_change_password"], me["is_official"]) == (False, False, False)
    assert "password_hash" not in me


async def test_sign_up_needs_an_account_invite_even_for_the_first_account(client: AsyncClient) -> None:
    res = await register(client)
    assert (res.status_code, res.json()["detail"]) == (403, "An invite code is required to sign up")
    assert (await register(client, invite_code="NOPE1234")).json()["detail"] == "Invalid invite code"


async def test_server_invites_do_not_create_accounts(client: AsyncClient) -> None:
    code, _ = await invite_code(client)
    assert (await register(client, invite_code=code)).status_code == 403


async def test_invite_link_works_as_the_code(client: AsyncClient) -> None:
    code = await make_account_invite()
    res = await register(client, invite_code=f"https://aureum.test/convite/{code.lower()}/")
    assert res.status_code == 201


async def test_without_invite_only_anyone_signs_up(client: AsyncClient, monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(get_settings(), "aureum_invite_only", False)
    assert (await client.get("/api/auth/config")).json() == {"invite_only": False}
    assert (await register(client)).status_code == 201


async def test_duplicate_sign_up_is_refused(client: AsyncClient) -> None:
    code = await make_account_invite()
    taken = await make_user(client, "taken")
    assert (await register(client, username="taken", email="new@example.com", invite_code=code)).status_code == 409
    assert (await register(client, username="newname", email=taken.email, invite_code=code)).status_code == 409
    assert (await register(client, invite_code=code)).status_code == 201


async def test_sign_up_validates_input(client: AsyncClient) -> None:
    assert (await invited(client, password="short")).status_code == 422
    assert (await invited(client, username="a b")).status_code == 422


async def test_username_check(client: AsyncClient) -> None:
    await make_user(client, "taken")

    async def check(name: str) -> dict:
        return (await client.get("/api/auth/username-available", params={"username": name})).json()

    assert await check("@Mari") == {"available": True, "reason": None}
    assert await check("TAKEN") == {"available": False, "reason": "taken"}
    assert await check("admin") == {"available": False, "reason": "reserved"}
    assert await check("a b") == {"available": False, "reason": "invalid"}


# --- Login and tokens ---------------------------------------------------------


async def test_login(client: AsyncClient) -> None:
    user = await make_user(client, "login")
    ok = await client.post("/api/auth/login", json={"email": "LOGIN@example.com", "password": PASSWORD})
    wrong = await client.post("/api/auth/login", json={"email": user.email, "password": "wrong-pass"})
    unknown = await client.post("/api/auth/login", json={"email": "no@example.com", "password": "whatever1"})
    assert ok.status_code == 200 and ok.json()["access_token"]
    assert wrong.status_code == 401
    assert unknown.status_code == 401


async def test_refresh_and_token_types(client: AsyncClient) -> None:
    await make_user(client, "tokens")
    tokens = (await client.post("/api/auth/login", json={"email": "tokens@example.com", "password": PASSWORD})).json()

    refreshed = await client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refreshed.status_code == 200
    assert (await client.get("/api/users/me", headers=bearer(refreshed.json()["access_token"]))).status_code == 200

    # Access and refresh tokens are not interchangeable.
    assert (await client.get("/api/users/me", headers=bearer(tokens["refresh_token"]))).status_code == 401
    assert (await client.post("/api/auth/refresh", json={"refresh_token": tokens["access_token"]})).status_code == 401


async def test_me_requires_valid_token(client: AsyncClient) -> None:
    assert (await client.get("/api/users/me")).status_code == 401
    assert (await client.get("/api/users/me", headers=bearer("garbage"))).status_code == 401
    ghost = create_token(uuid.uuid4(), "access")  # well-formed, but the user doesn't exist
    assert (await client.get("/api/users/me", headers=bearer(ghost))).status_code == 401


# --- Rate limits --------------------------------------------------------------


async def test_failed_logins_lock_the_account_for_a_while(client: AsyncClient) -> None:
    user = await make_user(client, "target")
    for _ in range(5):
        res = await client.post("/api/auth/login", json={"email": user.email, "password": "guess-1234"})
        assert res.status_code == 401
    locked = await client.post("/api/auth/login", json={"email": user.email, "password": PASSWORD})
    assert locked.status_code == 429  # even the right password waits
    assert int(locked.headers["retry-after"]) > 0


async def test_login_attempts_are_limited_per_ip(client: AsyncClient) -> None:
    codes = [
        (await client.post("/api/auth/login", json={"email": f"x{i}@example.com", "password": "guess-1234"})).status_code
        for i in range(11)
    ]
    assert codes[:10] == [401] * 10 and codes[10] == 429


async def test_sign_ups_are_limited_per_ip(client: AsyncClient) -> None:
    codes = [(await invited(client, username=f"user{i}", email=f"user{i}@example.com")).status_code for i in range(6)]
    assert codes[:5] == [201] * 5 and codes[5] == 429


async def test_forwarded_ip_is_ignored_unless_trusted(client: AsyncClient) -> None:
    # Spoofed X-Forwarded-For must not give a fresh per-IP budget.
    for i in range(10):
        await client.post("/api/auth/login", json={"email": f"y{i}@example.com", "password": "guess-1234"},
                          headers={"X-Forwarded-For": f"10.0.0.{i}"})
    res = await client.post("/api/auth/login", json={"email": "z@example.com", "password": "guess-1234"},
                            headers={"X-Forwarded-For": "10.9.9.9"})
    assert res.status_code == 429


# --- Browser origins ----------------------------------------------------------


async def test_cors_denies_other_sites(client: AsyncClient) -> None:
    preflight = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}
    evil = await client.options("/api/auth/login", headers={"Origin": "https://evil.example", **preflight})
    dev = await client.options("/api/auth/login", headers={"Origin": "http://localhost:5173", **preflight})
    assert "access-control-allow-origin" not in evil.headers
    assert dev.headers["access-control-allow-origin"] == "http://localhost:5173"
