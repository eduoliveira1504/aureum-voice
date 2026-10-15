from httpx import AsyncClient

from tests.test_auth import bearer, register


async def test_update_me(client: AsyncClient) -> None:
    tokens = await register(client)
    res = await client.patch(
        "/api/users/me",
        headers=bearer(tokens["access_token"]),
        json={"display_name": "Eduardo", "bio": "hi", "accent_color": "#ffaa00"},
    )
    assert res.status_code == 200
    body = res.json()
    assert (body["display_name"], body["bio"], body["accent_color"]) == ("Eduardo", "hi", "#ffaa00")


async def test_update_me_validates_color(client: AsyncClient) -> None:
    tokens = await register(client)
    res = await client.patch(
        "/api/users/me", headers=bearer(tokens["access_token"]), json={"accent_color": "red"}
    )
    assert res.status_code == 422


async def test_get_user_hides_email(client: AsyncClient) -> None:
    a = await register(client)
    b = await register(client, username="friend", email="friend@example.com")
    friend = await client.get("/api/users/me", headers=bearer(b["access_token"]))
    res = await client.get(f"/api/users/{friend.json()['id']}", headers=bearer(a["access_token"]))
    assert res.status_code == 200
    assert res.json()["username"] == "friend"
    assert "email" not in res.json()
