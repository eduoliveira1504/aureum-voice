"""Mentions of roles, @all and @here (block 4.2.4 follow-up; app/reads.py)."""

from typing import Any

from httpx import AsyncClient
from httpx_ws import aconnect_ws

from app.accounts import is_reserved
from app.permissions import Perm
from app.reads import mentioned_roles
from tests.helpers import ApiUser, make_server, make_user, text_channel, ws_client
from tests.test_private_channels import create_private
from tests.test_reads import read_state
from tests.test_roles import create_role, give
from tests.test_ws import next_event, ws_url


async def say(user: ApiUser, channel_id: str, content: str) -> dict[str, Any]:
    res = await user.post(f"/channels/{channel_id}/messages", {"content": content})
    assert res.status_code == 201, res.text
    return res.json()


async def mentions_of(user: ApiUser, server: dict[str, Any], channel_id: str) -> int:
    return (await read_state(user, server, channel_id))["mention_count"]


async def home_mentions(user: ApiUser) -> list[str]:
    return [m["message"]["content"] for m in (await user.get("/users/me/home")).json()["mentions"]]


def test_role_mentions_are_parsed() -> None:
    rid = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b"
    assert {str(r) for r in mentioned_roles(f"oi <@&{rid}> e <@&nope>")} == {rid}


def test_all_and_here_cant_be_usernames() -> None:
    assert is_reserved("all") and is_reserved("HERE")


async def test_all_reaches_everyone_who_sees_the_channel(client: AsyncClient) -> None:
    owner, ana, bia = [await make_user(client, n) for n in ("owner", "ana", "bia")]
    server = await make_server(owner, ana, bia)
    sid, chat = server["id"], text_channel(server)
    await say(owner, chat, "@all reunião agora")
    assert [await mentions_of(u, server, chat) for u in (ana, bia, owner)] == [1, 1, 0]
    assert await home_mentions(ana) == ["@all reunião agora"]

    # In a private channel, only who can see it.
    private = await create_private(owner, sid, allowed_members=[ana.id])
    await say(owner, private["id"], "@all só aqui")
    assert await mentions_of(ana, server, private["id"]) == 1
    assert "@all só aqui" not in await home_mentions(bia)


async def test_all_needs_the_permission(client: AsyncClient) -> None:
    owner, ana, bia = [await make_user(client, n) for n in ("owner", "ana", "bia")]
    server = await make_server(owner, ana, bia)
    sid, chat = server["id"], text_channel(server)
    await say(ana, chat, "@all oi gente")
    assert await mentions_of(bia, server, chat) == 0
    # With the permission (a role that has it), it works.
    role = await create_role(owner, sid, "Avisos", Perm.MENTION_EVERYONE)
    await give(owner, sid, ana, role)
    await say(ana, chat, "@all agora sim")
    assert await mentions_of(bia, server, chat) == 1


async def test_here_reaches_only_who_is_online(client: AsyncClient) -> None:
    owner, ana, bia = [await make_user(client, n) for n in ("owner", "ana", "bia")]
    server = await make_server(owner, ana, bia)
    chat = text_channel(server)
    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as ws:
        await next_event(ws, "ready")
        await say(owner, chat, "@here quem tá aí?")
        created = await next_event(ws, "message.created")
        assert created["mentions"] == [ana.id]
    assert await mentions_of(ana, server, chat) == 1
    assert await mentions_of(bia, server, chat) == 0


async def test_a_role_reaches_its_members(client: AsyncClient) -> None:
    owner, ana, bia, caio = [await make_user(client, n) for n in ("owner", "ana", "bia", "caio")]
    server = await make_server(owner, ana, bia, caio)
    sid, chat = server["id"], text_channel(server)
    open_role = await create_role(owner, sid, "Jogadores", mentionable=True)
    closed_role = await create_role(owner, sid, "Staff")
    await give(owner, sid, ana, open_role)
    await give(owner, sid, bia, closed_role)

    # A mentionable role: anyone can call it.
    await say(caio, chat, f"<@&{open_role['id']}> bora jogar")
    assert [await mentions_of(u, server, chat) for u in (ana, bia)] == [1, 0]
    # A role that isn't: only with MENTION_EVERYONE (the owner has every permission).
    await say(caio, chat, f"<@&{closed_role['id']}> socorro")
    assert await mentions_of(bia, server, chat) == 0
    await say(owner, chat, f"<@&{closed_role['id']}> reunião")
    assert await mentions_of(bia, server, chat) == 1
    # A role of another server, or @everyone's own id, means nothing.
    other = await make_server(owner, name="Outro")
    foreign = await create_role(owner, other["id"], "Fora", mentionable=True)
    await say(owner, chat, f"<@&{foreign['id']}> <@&{sid}> nada")
    assert await mentions_of(caio, server, chat) == 0


async def test_one_notification_however_many_ways(client: AsyncClient) -> None:
    owner, ana = await make_user(client, "owner"), await make_user(client, "ana")
    server = await make_server(owner, ana)
    sid, chat = server["id"], text_channel(server)
    role = await create_role(owner, sid, "Time", mentionable=True)
    await give(owner, sid, ana, role)
    message = await say(owner, chat, f"@ana <@&{role['id']}> @all")
    assert await mentions_of(ana, server, chat) == 1
    assert await home_mentions(ana) == [message["content"]]
