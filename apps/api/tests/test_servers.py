from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import update

from app.db import engine
from app.models import Invite
from tests.helpers import make_server, make_user


async def test_create_server_with_default_channels(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    server = await make_server(owner)
    assert {(c["name"], c["type"]) for c in server["channels"]} == {("geral", "text"), ("Geral", "voice")}
    assert [(m["user"]["id"], m["role"]) for m in server["members"]] == [(owner.id, "owner")]

    mine = (await owner.get("/servers")).json()
    assert [s["id"] for s in mine] == [server["id"]]


async def test_non_members_cannot_see_server(client: AsyncClient) -> None:
    owner, stranger = await make_user(client, "owner"), await make_user(client, "stranger")
    server = await make_server(owner)
    assert (await stranger.get(f"/servers/{server['id']}")).status_code == 404
    assert (await stranger.get("/servers")).json() == []


async def test_invite_join_flow(client: AsyncClient) -> None:
    owner, friend = await make_user(client, "owner"), await make_user(client, "friend")
    server = await make_server(owner)
    invite = (await owner.post(f"/servers/{server['id']}/invites", {"max_uses": 1})).json()

    joined = await friend.post(f"/invites/{invite['code']}/join")
    assert joined.status_code == 200
    assert {m["user"]["id"] for m in joined.json()["members"]} == {owner.id, friend.id}

    # Joining again is idempotent and doesn't consume a use.
    assert (await friend.post(f"/invites/{invite['code']}/join")).status_code == 200
    third = await make_user(client, "third")
    assert (await third.post(f"/invites/{invite['code']}/join")).status_code == 410
    assert (await third.post("/invites/nope/join")).status_code == 404


async def test_expired_invite(client: AsyncClient) -> None:
    owner, friend = await make_user(client, "owner"), await make_user(client, "friend")
    server = await make_server(owner)
    code = (await owner.post(f"/servers/{server['id']}/invites", {})).json()["code"]
    async with engine.begin() as conn:
        await conn.execute(
            update(Invite).where(Invite.code == code).values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )
    assert (await friend.post(f"/invites/{code}/join")).status_code == 410


async def test_roles(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    server = await make_server(owner, member)
    sid = server["id"]

    assert (await member.post(f"/servers/{sid}/channels", {"name": "x"})).status_code == 403
    assert (await member.patch(f"/servers/{sid}", {"name": "Hacked"})).status_code == 403
    assert (await member.delete(f"/servers/{sid}")).status_code == 403

    created = await owner.post(f"/servers/{sid}/channels", {"name": "Bate Papo", "type": "text"})
    assert created.status_code == 201
    assert created.json()["name"] == "bate-papo"
    assert created.json()["position"] == 2

    renamed = await owner.patch(f"/channels/{created.json()['id']}", {"name": "Memes"})
    assert renamed.json()["name"] == "memes"
    assert (await owner.patch(f"/servers/{sid}", {"name": "Renamed"})).json()["name"] == "Renamed"


async def test_leave_and_delete(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    server = await make_server(owner, member)
    sid = server["id"]

    assert (await owner.delete(f"/servers/{sid}/members/me")).status_code == 400
    assert (await member.delete(f"/servers/{sid}/members/me")).status_code == 204
    assert (await member.get(f"/servers/{sid}")).status_code == 404

    assert (await owner.delete(f"/servers/{sid}")).status_code == 204
    assert (await owner.get(f"/servers/{sid}")).status_code == 404
