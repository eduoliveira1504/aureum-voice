"""Block 4.2.2: deleting an account (30 days to change your mind, owners blocked)."""

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select, text

from app import account_deletion
from app.db import SessionLocal, engine
from app.models import Friendship, PioneerNumber, User
from tests.helpers import PASSWORD, ApiUser, inbox, last_code, make_server, make_user, text_channel
from tests.test_account_state import login
from tests.test_attachments import uploaded
from tests.test_friends import befriend
from tests.test_profile import GIF, upload as upload_image


async def ask_deletion(user: ApiUser, *, delete_messages: bool = False) -> dict:
    assert (await user.post("/users/me/deletion/code", {"password": PASSWORD})).status_code == 202
    code = await last_code(user.email)
    res = await user.post("/users/me/deletion", {"password": PASSWORD, "code": code, "delete_messages": delete_messages})
    assert res.status_code == 200, res.text
    return res.json()


async def make_due(user_id: str) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text("UPDATE users SET deletion_due_at = now() - interval '1 minute' WHERE id = :id"), {"id": uuid.UUID(user_id)}
        )


async def exists(user_id: str) -> bool:
    async with SessionLocal() as session:
        return await session.get(User, uuid.UUID(user_id)) is not None


async def test_owners_are_blocked_until_they_hand_the_server_over(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia, name="Turma")
    res = await ana.post("/users/me/deletion/code", {"password": PASSWORD})
    assert res.status_code == 409
    assert res.json()["detail"]["servers"] == [{"id": server["id"], "name": "Turma"}]

    await ana.post(f"/servers/{server['id']}/transfer", {"user_id": bia.id})
    await ask_deletion(ana)


async def test_asking_needs_password_and_code(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    assert (await ana.post("/users/me/deletion/code", {"password": "wrong-password"})).status_code == 403
    assert (await ana.post("/users/me/deletion/code", {"password": PASSWORD})).status_code == 202
    assert "excluir" in (await inbox())[-1].subject
    wrong = await ana.post("/users/me/deletion", {"password": PASSWORD, "code": "000000"})
    assert wrong.status_code == 400
    assert (await ana.get("/users/me")).json()["deletion_due_at"] is None


async def test_scheduled_deletion_and_cancelling(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await befriend(ana, bia)
    due = datetime.fromisoformat((await ask_deletion(ana))["deletion_due_at"])
    assert timedelta(days=29, hours=23) < due - datetime.now(UTC) <= timedelta(days=30)
    assert (await inbox())[-1].subject == "Sua conta vai ser excluída"

    # Deactivated meanwhile: signed out and out of friend lists.
    assert (await ana.get("/users/me")).status_code == 401
    assert (await bia.get("/friends")).json() == []

    # Signing in doesn't reactivate it: only the cancel screen works.
    ana = await login(client, ana)
    me = (await ana.get("/users/me")).json()
    assert me["deletion_due_at"] is not None
    blocked = await ana.get("/friends")
    assert blocked.status_code == 403 and blocked.json()["detail"] == "Account deletion scheduled"

    assert (await ana.delete("/users/me/deletion")).status_code == 204
    assert (await ana.get("/users/me")).json()["deletion_due_at"] is None
    assert [f["user"]["id"] for f in (await bia.get("/friends")).json()] == [ana.id]
    assert (await ana.delete("/users/me/deletion")).status_code == 404


async def test_the_job_deletes_only_due_accounts(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await ask_deletion(ana)
    await ask_deletion(bia)
    await make_due(ana.id)
    assert await account_deletion.finish_due() == 1
    assert not await exists(ana.id)
    assert await exists(bia.id)
    assert (await inbox())[-1].subject == "Sua conta foi excluída"


async def test_deleting_keeps_messages_as_deleted_user(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await befriend(ana, bia)
    server = await make_server(bia, ana)
    cid = text_channel(server)
    await ana.post(f"/channels/{cid}/messages", {"content": "fica"})
    avatar = (await upload_image(ana, "avatar", GIF)).json()["avatar_url"]
    async with SessionLocal() as session:
        session.add(PioneerNumber(number=7, user_id=uuid.UUID(ana.id)))
        await session.commit()

    await ask_deletion(ana)
    await make_due(ana.id)
    assert await account_deletion.finish_due() == 1

    messages = (await bia.get(f"/channels/{cid}/messages")).json()
    assert [(m["content"], m["author"]) for m in messages if m["content"] == "fica"] == [("fica", None)]
    assert (await client.get(avatar)).status_code == 404  # the file is gone from MinIO
    assert ana.id not in {m["user"]["id"] for m in (await bia.get(f"/servers/{server['id']}")).json()["members"]}
    async with SessionLocal() as session:
        assert list(await session.scalars(select(Friendship))) == []
        pioneer = await session.get(PioneerNumber, 7)
        assert pioneer is not None and pioneer.user_id is None  # the number is never reused


async def test_deleting_messages_and_their_files_when_asked(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(bia, ana)
    cid = text_channel(server)
    file = await uploaded(ana, cid, "foto.gif", GIF, "image/gif")
    await ana.post(f"/channels/{cid}/messages", {"content": "some", "attachment_ids": [file["id"]]})
    await bia.post(f"/channels/{cid}/messages", {"content": "da bia"})
    file_url = (await bia.get(f"/channels/{cid}/messages")).json()[0]["attachments"][0]["url"]
    assert (await bia.client.get(file_url, headers=bia.headers)).status_code == 200

    await ask_deletion(ana, delete_messages=True)
    await make_due(ana.id)
    await account_deletion.finish_due()

    assert [m["content"] for m in (await bia.get(f"/channels/{cid}/messages")).json()] == ["da bia"]
    assert (await bia.client.get(file_url, headers=bia.headers)).status_code == 404


async def test_the_username_is_held_after_deletion(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    await ask_deletion(ana)
    await make_due(ana.id)
    await account_deletion.finish_due()
    check = (await client.get("/api/auth/username-available", params={"username": "ana"})).json()
    assert check == {"available": False, "reason": "taken"}
    async with SessionLocal() as session:
        assert await account_deletion.username_held(session, "Ana")
        await session.execute(text("UPDATE released_usernames SET held_until = now() - interval '1 second'"))
        await session.commit()
        assert not await account_deletion.username_held(session, "ana")
