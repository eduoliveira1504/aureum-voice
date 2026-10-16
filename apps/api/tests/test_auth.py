import uuid

from httpx import AsyncClient

from app.security import create_token
from tests.helpers import PASSWORD, make_server, make_user

USER = {"username": "Edu", "email": "Edu@Example.com", "password": "correct-horse-1"}


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def register(client: AsyncClient, **fields: str):  # noqa: ANN201
    return await client.post("/api/auth/register", json={**USER, **fields})


async def invite_code(client: AsyncClient, **options: int) -> tuple[str, dict]:
    """An owner with a server hands out an invite (the owner is created directly in the DB)."""
    owner = await make_user(client, f"owner{uuid.uuid4().hex[:6]}")
    server = await make_server(owner)
    res = await owner.post(f"/servers/{server['id']}/invites", options)
    return res.json()["code"], server


# --- Sign-up ------------------------------------------------------------------


async def test_first_account_needs_no_invite_and_normalizes_fields(client: AsyncClient) -> None:
    res = await register(client)
    assert res.status_code == 201
    me = (await client.get("/api/users/me", headers=bearer(res.json()["access_token"]))).json()
    assert (me["username"], me["email"], me["display_name"]) == ("edu", "edu@example.com", "edu")
    assert "password_hash" not in me


async def test_sign_up_requires_a_valid_invite_once_someone_exists(client: AsyncClient) -> None:
    code, server = await invite_code(client, max_uses=1)

    assert (await register(client)).status_code == 403
    assert (await register(client, invite_code="nope")).status_code == 403

    res = await register(client, invite_code=code)
    assert res.status_code == 201
    token = res.json()["access_token"]
    mine = (await client.get("/api/servers", headers=bearer(token))).json()
    assert [s["id"] for s in mine] == [server["id"]]  # joined the inviting server

    used_up = await register(client, username="other", email="other@example.com", invite_code=code)
    assert used_up.status_code == 403


async def test_duplicate_sign_up_does_not_spend_the_invite(client: AsyncClient) -> None:
    code, _ = await invite_code(client, max_uses=1)
    taken = await make_user(client, "taken")

    dup = await register(client, username="taken", email="new@example.com", invite_code=code)
    assert dup.status_code == 409
    dup_email = await register(client, username="newname", email=taken.email, invite_code=code)
    assert dup_email.status_code == 409
    assert (await register(client, invite_code=code)).status_code == 201  # use still available


async def test_sign_up_validates_input(client: AsyncClient) -> None:
    assert (await register(client, password="short")).status_code == 422
    assert (await register(client, username="a b")).status_code == 422


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
    codes = [(await register(client, username=f"user{i}", email=f"user{i}@example.com")).status_code for i in range(6)]
    assert codes[5] == 429


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
