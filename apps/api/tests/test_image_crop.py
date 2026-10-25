import io
import json
from typing import Any

from httpx import AsyncClient
from PIL import Image, ImageSequence

from tests.helpers import ApiUser, make_server, make_user

RED, GREEN, BLUE, WHITE = (255, 0, 0), (0, 200, 0), (0, 0, 255), (255, 255, 255)


def quadrants(width: int = 200, height: int = 100, fmt: str = "PNG") -> bytes:
    """Red top-left, green top-right, blue bottom-left, white bottom-right."""
    im = Image.new("RGB", (width, height), WHITE)
    im.paste(RED, (0, 0, width // 2, height // 2))
    im.paste(GREEN, (width // 2, 0, width, height // 2))
    im.paste(BLUE, (0, height // 2, width // 2, height))
    buffer = io.BytesIO()
    im.save(buffer, fmt)
    return buffer.getvalue()


def animated(fmt: str, durations: list[int], loop: int | None = 0) -> bytes:
    frames = [Image.new("RGB", (120, 80), color) for color in (RED, GREEN, BLUE)[: len(durations)]]
    buffer = io.BytesIO()
    extra: dict[str, Any] = {} if loop is None else {"loop": loop}
    frames[0].save(buffer, fmt, save_all=True, append_images=frames[1:], duration=durations, **extra)
    return buffer.getvalue()


def crop(x: int, y: int, width: int, height: int, rotate: int = 0) -> str:
    return json.dumps({"x": x, "y": y, "width": width, "height": height, "rotate": rotate})


async def upload(user: ApiUser, path: str, data: bytes, rect: str | None) -> Any:
    return await user.client.post(
        f"/api{path}", headers=user.headers, files={"file": ("x", data, "image/png")}, data={"crop": rect} if rect else None
    )


async def fetch(client: AsyncClient, url: str) -> Image.Image:
    res = await client.get(url)
    assert res.status_code == 200
    return Image.open(io.BytesIO(res.content))


def near(pixel: Any, color: tuple[int, int, int]) -> bool:
    return all(abs(a - b) <= 40 for a, b in zip(pixel[:3], color, strict=True))


async def test_static_crop_keeps_the_original(client: AsyncClient) -> None:
    user = await make_user(client, "cropper")
    original = quadrants()
    res = await upload(user, "/users/me/avatar", original, crop(100, 0, 100, 100))
    assert res.status_code == 200, res.text
    me = res.json()
    assert me["avatar_crop"] == {"x": 100, "y": 0, "width": 100, "height": 100, "rotate": 0}

    im = await fetch(client, me["avatar_url"])
    assert im.size == (100, 100) and im.format == "PNG"
    assert near(im.getpixel((25, 25)), GREEN) and near(im.getpixel((25, 75)), WHITE)

    kept = await user.get("/users/me/avatar/original")
    assert kept.status_code == 200 and kept.content == original
    assert "no-store" in kept.headers["cache-control"]
    # The original is private: not under /api/media, not in what others see.
    other = await make_user(client, "peeker")
    public = (await other.get(f"/users/{user.id}")).json()
    assert "avatar_crop" not in public and "avatar_source" not in public


async def test_rotation_and_scale_down(client: AsyncClient) -> None:
    user = await make_user(client, "turner")
    # Turned 90° clockwise, 200x100 becomes 100x200 with red at the top-right.
    res = await upload(user, "/users/me/avatar", quadrants(), crop(50, 0, 50, 50, rotate=90))
    im = await fetch(client, res.json()["avatar_url"])
    assert im.size == (50, 50) and near(im.getpixel((25, 25)), RED)

    big = quadrants(2000, 2000, "JPEG")
    res = await upload(user, "/users/me/avatar", big, crop(0, 0, 2000, 2000))
    im = await fetch(client, res.json()["avatar_url"])
    assert im.size == (512, 512) and im.format == "JPEG"  # avatars are kept at most 512 px

    banner = await upload(user, "/users/me/banner", quadrants(4000, 1000), crop(0, 0, 4000, 1000))
    assert (await fetch(client, banner.json()["banner_url"])).size == (1600, 400)


async def test_animated_gif_and_webp_keep_their_animation(client: AsyncClient) -> None:
    user = await make_user(client, "gifs")
    for fmt in ("GIF", "WEBP"):
        res = await upload(user, "/users/me/avatar", animated(fmt, [100, 200, 300]), crop(20, 10, 60, 60))
        assert res.status_code == 200, res.text
        im = await fetch(client, res.json()["avatar_url"])
        assert im.format == fmt and im.size == (60, 60)
        # The iterator seeks the same image: read each frame while it's the current one (WebP
        # fills in the duration once the frame is decoded).
        frames = [(f.convert("RGB").getpixel((30, 30)), f.info["duration"]) for f in ImageSequence.Iterator(im)]
        assert [d for _, d in frames] == [100, 200, 300]
        assert near(frames[1][0], GREEN)
        assert im.info.get("loop") == 0

    once = await upload(user, "/users/me/avatar", animated("GIF", [100, 100], loop=None), crop(0, 0, 50, 50))
    assert "loop" not in (await fetch(client, once.json()["avatar_url"])).info  # still plays once


async def test_recrop_from_the_original(client: AsyncClient) -> None:
    user = await make_user(client, "adjust")
    first = (await upload(user, "/users/me/avatar", quadrants(), crop(0, 0, 100, 100))).json()["avatar_url"]

    res = await user.put("/users/me/avatar/crop", {"x": 0, "y": 50, "width": 50, "height": 50})
    assert res.status_code == 200
    second = res.json()["avatar_url"]
    assert second != first and res.json()["avatar_crop"]["y"] == 50
    assert near((await fetch(client, second)).getpixel((10, 10)), BLUE)
    assert (await client.get(first)).status_code == 404  # the old crop is gone, the original stays
    assert (await user.get("/users/me/avatar/original")).content == quadrants()

    # An image uploaded without a crop (older apps) has nothing to re-crop.
    await user.client.post("/api/users/me/banner", headers=user.headers, files={"file": ("x", quadrants(), "image/png")})
    assert (await user.put("/users/me/banner/crop", {"x": 0, "y": 0, "width": 10, "height": 10})).status_code == 409
    assert (await user.get("/users/me/banner/original")).status_code == 404


async def test_removing_or_replacing_deletes_the_original(client: AsyncClient) -> None:
    user = await make_user(client, "cleanup")
    await upload(user, "/users/me/avatar", quadrants(), crop(0, 0, 100, 100))
    replaced = await user.client.post("/api/users/me/avatar", headers=user.headers, files={"file": ("x", quadrants(), "image/png")})
    assert replaced.json()["avatar_crop"] is None
    assert (await user.get("/users/me/avatar/original")).status_code == 404

    await upload(user, "/users/me/avatar", quadrants(), crop(0, 0, 100, 100))
    removed = (await user.delete("/users/me/avatar")).json()
    assert removed["avatar_url"] is None and removed["avatar_crop"] is None
    assert (await user.get("/users/me/avatar/original")).status_code == 404


async def test_bad_crops(client: AsyncClient) -> None:
    user = await make_user(client, "badcrop")
    assert (await upload(user, "/users/me/avatar", quadrants(), crop(500, 500, 10, 10))).status_code == 422
    assert (await upload(user, "/users/me/avatar", quadrants(), crop(0, 0, 10, 10, rotate=45))).status_code == 422
    assert (await upload(user, "/users/me/avatar", quadrants(), "not json")).status_code == 422
    # Valid header, broken body: detected as PNG, but it can't be decoded to crop.
    broken = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    assert (await upload(user, "/users/me/avatar", broken, crop(0, 0, 10, 10))).status_code == 422
    # A rectangle past the edge is clamped to the image.
    res = await upload(user, "/users/me/avatar", quadrants(), crop(150, 50, 500, 500))
    assert (await fetch(client, res.json()["avatar_url"])).size == (50, 50)


async def test_server_icon_and_banner_crop(client: AsyncClient) -> None:
    owner, member = await make_user(client, "cropowner"), await make_user(client, "cropmember")
    sid = (await make_server(owner, member))["id"]

    assert (await upload(member, f"/servers/{sid}/icon", quadrants(), crop(0, 0, 50, 50))).status_code == 403
    res = await upload(owner, f"/servers/{sid}/icon", quadrants(), crop(0, 0, 50, 50))
    assert res.status_code == 200 and res.json()["icon_crop"]["width"] == 50
    assert near((await fetch(client, res.json()["icon_url"])).getpixel((5, 5)), RED)

    assert (await member.get(f"/servers/{sid}/icon/original")).status_code == 403
    assert (await owner.get(f"/servers/{sid}/icon/original")).content == quadrants()
    assert (await member.put(f"/servers/{sid}/icon/crop", {"x": 0, "y": 0, "width": 9, "height": 9})).status_code == 403
    again = await owner.put(f"/servers/{sid}/icon/crop", {"x": 100, "y": 0, "width": 50, "height": 50})
    assert near((await fetch(client, again.json()["icon_url"])).getpixel((5, 5)), GREEN)

    banner = await upload(owner, f"/servers/{sid}/banner", animated("GIF", [80, 80]), crop(0, 0, 120, 40))
    assert len(list(ImageSequence.Iterator(await fetch(client, banner.json()["banner_url"])))) == 2
    assert (await owner.delete(f"/servers/{sid}/banner")).json()["banner_crop"] is None
