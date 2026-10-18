from httpx import AsyncClient
from httpx_ws import aconnect_ws

from tests.helpers import ApiUser, make_server, make_user, ws_client
from tests.test_ws import next_event

# Smallest valid-looking files: only the leading bytes matter for type detection.
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
GIF = b"GIF89a" + b"\x01\x00\x01\x00" + b"\x00" * 64  # animated GIFs share this header
WEBP = b"RIFF" + (76).to_bytes(4, "little") + b"WEBPVP8X" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


async def upload(user: ApiUser, kind: str, data: bytes, filename: str = "image.bin", content_type: str = "image/png"):  # noqa: ANN201
    return await user.client.post(
        f"/api/users/me/{kind}", headers=user.headers, files={"file": (filename, data, content_type)}
    )


async def test_upload_each_format_and_serve_it(client: AsyncClient) -> None:
    user = await make_user(client, "pic")
    for data, mime in ((PNG, "image/png"), (GIF, "image/gif"), (WEBP, "image/webp"), (JPEG, "image/jpeg")):
        res = await upload(user, "avatar", data)
        assert res.status_code == 200, res.text
        url = res.json()["avatar_url"]
        assert url.startswith("/api/media/avatars/")

        media = await client.get(url)  # no auth needed: <img> tags can't send headers
        assert media.status_code == 200
        assert media.content == data
        assert media.headers["content-type"] == mime
        assert "immutable" in media.headers["cache-control"]
        assert media.headers["x-content-type-options"] == "nosniff"


async def test_banner_upload(client: AsyncClient) -> None:
    user = await make_user(client, "banner")
    res = await upload(user, "banner", GIF)
    assert res.status_code == 200
    assert res.json()["banner_url"].startswith("/api/media/banners/")
    assert res.json()["avatar_url"] is None


async def test_type_is_checked_on_bytes_not_name(client: AsyncClient) -> None:
    user = await make_user(client, "liar")
    res = await upload(user, "avatar", b"<script>alert(1)</script>", filename="evil.png", content_type="image/png")
    assert res.status_code == 415


async def test_size_limit(client: AsyncClient) -> None:
    user = await make_user(client, "big")
    res = await upload(user, "avatar", PNG + b"\x00" * (8 * 1024 * 1024))
    assert res.status_code == 413


async def test_replacing_and_removing_deletes_old_files(client: AsyncClient) -> None:
    user = await make_user(client, "swap")
    first = (await upload(user, "avatar", PNG)).json()["avatar_url"]
    second = (await upload(user, "avatar", GIF)).json()["avatar_url"]
    assert first != second
    assert (await client.get(first)).status_code == 404
    assert (await client.get(second)).status_code == 200

    removed = await user.delete("/users/me/avatar")
    assert removed.status_code == 200 and removed.json()["avatar_url"] is None
    assert (await client.get(second)).status_code == 404


async def test_media_route_only_serves_profile_images(client: AsyncClient) -> None:
    assert (await client.get("/api/media/avatars/../../etc/passwd")).status_code == 404
    assert (await client.get("/api/media/secrets/file.png")).status_code == 404
    assert (await client.get("/api/media/avatars/nope/missing.png")).status_code == 404


async def test_profile_changes_reach_server_members_live(client: AsyncClient) -> None:
    owner, friend = await make_user(client, "owner"), await make_user(client, "friend")
    await make_server(owner, friend)

    async with ws_client() as wsc, aconnect_ws(f"/ws?token={owner.token}", wsc) as ws:
        await next_event(ws, "ready")
        await friend.patch("/users/me", {"display_name": "Amigão", "bio": "oi!", "accent_color": "#22aa88"})
        event = await next_event(ws, "user.updated")
        assert (event["id"], event["display_name"], event["bio"], event["accent_color"]) == (
            friend.id,
            "Amigão",
            "oi!",
            "#22aa88",
        )
        assert "email" not in event

        await upload(friend, "avatar", PNG)
        assert (await next_event(ws, "user.updated"))["avatar_url"].startswith("/api/media/avatars/")


async def test_rich_profile_fields(client: AsyncClient) -> None:
    user = await make_user(client, "rich")
    body = {
        "pronouns": "ele/dele",
        "custom_status": {"text": "Fazendo a fase 2", "emoji": "🛠️"},
        "avatar_frame": "amethyst",
        "favorite_song": {"title": "Aquarela", "artist": "Toquinho", "url": "https://example.com/aquarela"},
        "links": [{"label": "GitHub", "url": "https://github.com/rich"}],
    }
    res = await user.patch("/users/me", body)
    assert res.status_code == 200, res.text
    me = res.json()
    assert me["pronouns"] == "ele/dele"
    assert me["custom_status"] == {"text": "Fazendo a fase 2", "emoji": "🛠️", "expires_at": None}
    assert me["avatar_frame"] == "amethyst"
    assert me["favorite_song"]["artist"] == "Toquinho"
    assert me["links"] == [{"label": "GitHub", "url": "https://github.com/rich"}]
    assert me["badges"] == []

    other = await make_user(client, "viewer")
    assert (await other.get(f"/users/{user.id}")).json()["avatar_frame"] == "amethyst"

    cleared = (await user.patch("/users/me", {"custom_status": None, "avatar_frame": None, "links": None, "pronouns": ""})).json()
    assert cleared["custom_status"] is None
    assert cleared["avatar_frame"] == "none"
    assert cleared["links"] == []
    assert cleared["pronouns"] is None


async def test_profile_validation(client: AsyncClient) -> None:
    user = await make_user(client, "strict")
    link = {"label": "x", "url": "https://example.com"}
    bad = [
        {"links": [link] * 6},
        {"links": [{"label": "x", "url": "http://example.com"}]},
        {"links": [{"label": "x", "url": "javascript:alert(1)"}]},
        {"favorite_song": {"title": "t", "artist": "a", "url": "ftp://example.com"}},
        {"favorite_song": {"title": "", "artist": "a"}},
        {"custom_status": {"text": ""}},
        {"avatar_frame": "rainbow"},
        {"badges": ["founder"]},  # ignored: badges aren't user-editable
    ]
    for body in bad[:-1]:
        assert (await user.patch("/users/me", body)).status_code == 422, body
    res = await user.patch("/users/me", bad[-1])
    assert res.status_code == 200 and res.json()["badges"] == []


async def test_expired_custom_status_is_hidden(client: AsyncClient) -> None:
    user = await make_user(client, "brb")
    past, future = "2020-01-01T00:00:00Z", "2999-01-01T00:00:00Z"
    res = await user.patch("/users/me", {"custom_status": {"text": "volto já", "expires_at": future}})
    assert res.json()["custom_status"]["text"] == "volto já"
    res = await user.patch("/users/me", {"custom_status": {"text": "volto já", "expires_at": past}})
    assert res.json()["custom_status"] is None
    assert (await user.get("/users/me")).json()["custom_status"] is None


async def test_badges_are_granted_by_the_cli(client: AsyncClient) -> None:
    from app import cli

    user = await make_user(client, "pioneer")
    assert await cli.badges("grant", "pioneer", "beta") == 0
    assert await cli.badges("grant", "pioneer", "founder") == 0
    assert (await user.get("/users/me")).json()["badges"] == ["founder", "beta"]
    assert await cli.badges("revoke", "pioneer", "beta") == 0
    assert (await user.get("/users/me")).json()["badges"] == ["founder"]
    assert await cli.badges("grant", "pioneer", "admin") == 2
    assert await cli.badges("grant", "nobody", "beta") == 1
