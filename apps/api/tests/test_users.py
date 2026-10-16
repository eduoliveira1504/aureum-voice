from httpx import AsyncClient

from tests.helpers import make_server, make_user


async def test_update_me(client: AsyncClient) -> None:
    user = await make_user(client, "me")
    res = await user.patch("/users/me", {"display_name": "Eduardo", "bio": "hi", "accent_color": "#ffaa00"})
    assert res.status_code == 200
    body = res.json()
    assert (body["display_name"], body["bio"], body["accent_color"]) == ("Eduardo", "hi", "#ffaa00")


async def test_update_me_validates_color(client: AsyncClient) -> None:
    user = await make_user(client, "color")
    assert (await user.patch("/users/me", {"accent_color": "red"})).status_code == 422


async def test_get_user_hides_email(client: AsyncClient) -> None:
    owner, friend = await make_user(client, "owner"), await make_user(client, "friend")
    await make_server(owner, friend)
    res = await owner.get(f"/users/{friend.id}")
    assert res.status_code == 200
    assert res.json()["username"] == "friend"
    assert "email" not in res.json()
