from httpx import AsyncClient

from app.security import create_token

USER = {"username": "Edu", "email": "Edu@Example.com", "password": "correct-horse-1"}


async def register(client: AsyncClient, **overrides: str) -> dict:
    res = await client.post("/api/auth/register", json={**USER, **overrides})
    assert res.status_code == 201, res.text
    return res.json()


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_register_returns_tokens_and_normalizes_fields(client: AsyncClient) -> None:
    tokens = await register(client)
    me = await client.get("/api/users/me", headers=bearer(tokens["access_token"]))
    assert me.status_code == 200
    body = me.json()
    assert body["username"] == "edu"
    assert body["email"] == "edu@example.com"
    assert body["display_name"] == "edu"
    assert "password_hash" not in body


async def test_register_rejects_duplicates(client: AsyncClient) -> None:
    await register(client)
    same_username = await client.post("/api/auth/register", json={**USER, "email": "x@example.com"})
    same_email = await client.post("/api/auth/register", json={**USER, "username": "other"})
    assert same_username.status_code == 409
    assert same_email.status_code == 409


async def test_register_validates_input(client: AsyncClient) -> None:
    short_pw = await client.post("/api/auth/register", json={**USER, "password": "short"})
    bad_name = await client.post("/api/auth/register", json={**USER, "username": "a b"})
    assert short_pw.status_code == 422
    assert bad_name.status_code == 422


async def test_login(client: AsyncClient) -> None:
    await register(client)
    ok = await client.post("/api/auth/login", json={"email": "EDU@example.com", "password": USER["password"]})
    wrong = await client.post("/api/auth/login", json={"email": USER["email"], "password": "wrong-pass"})
    unknown = await client.post("/api/auth/login", json={"email": "no@example.com", "password": "whatever1"})
    assert ok.status_code == 200 and ok.json()["access_token"]
    assert wrong.status_code == 401
    assert unknown.status_code == 401


async def test_refresh(client: AsyncClient) -> None:
    tokens = await register(client)
    res = await client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert res.status_code == 200
    me = await client.get("/api/users/me", headers=bearer(res.json()["access_token"]))
    assert me.status_code == 200


async def test_token_types_are_not_interchangeable(client: AsyncClient) -> None:
    tokens = await register(client)
    me = await client.get("/api/users/me", headers=bearer(tokens["refresh_token"]))
    refresh = await client.post("/api/auth/refresh", json={"refresh_token": tokens["access_token"]})
    assert me.status_code == 401
    assert refresh.status_code == 401


async def test_me_requires_valid_token(client: AsyncClient) -> None:
    assert (await client.get("/api/users/me")).status_code == 401
    assert (await client.get("/api/users/me", headers=bearer("garbage"))).status_code == 401


async def test_token_for_deleted_user_is_rejected(client: AsyncClient) -> None:
    import uuid

    token = create_token(uuid.uuid4(), "access")
    assert (await client.get("/api/users/me", headers=bearer(token))).status_code == 401
