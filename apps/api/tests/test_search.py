"""Search inside a server (block 4.2.4)."""

from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import text

from app.db import engine
from app.permissions import Perm
from tests.helpers import ApiUser, make_server, make_user, text_channel
from tests.test_private_channels import create_private


async def say(user: ApiUser, channel_id: str, content: str) -> dict[str, Any]:
    res = await user.post(f"/channels/{channel_id}/messages", {"content": content})
    assert res.status_code == 201, res.text
    return res.json()


async def search(user: ApiUser, server_id: str, **params: Any) -> list[str]:
    res = await user.get(f"/servers/{server_id}/search", params=params)
    assert res.status_code == 200, res.text
    return [m["content"] for m in res.json()["messages"]]


async def test_finds_words_in_portuguese_newest_first(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    server = await make_server(ana)
    sid, chat = server["id"], text_channel(server)
    await say(ana, chat, "vamos jogar amanhã")
    await say(ana, chat, "nada a ver")
    await say(ana, chat, "quem joga hoje?")
    # Stemming: "jogar" also finds "joga".
    assert await search(ana, sid, q="jogar") == ["quem joga hoje?", "vamos jogar amanhã"]
    assert await search(ana, sid, q="pizza") == []
    res = (await ana.get(f"/servers/{sid}/search", params={"q": "jogar"})).json()
    assert res["messages"][0]["channel_id"] == chat and res["messages"][0]["author"]["id"] == ana.id


async def test_never_shows_a_channel_without_access(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    server = await make_server(owner, member)
    sid = server["id"]
    private = await create_private(owner, sid)
    await say(owner, private["id"], "segredo do time")
    await say(owner, text_channel(server), "segredo aberto")
    assert await search(owner, sid, q="segredo") == ["segredo aberto", "segredo do time"]
    assert await search(member, sid, q="segredo") == ["segredo aberto"]
    # Asking for that channel by id gives nothing, the same as a channel that doesn't exist.
    assert await search(member, sid, q="segredo", channel_id=private["id"]) == []


async def test_needs_the_history_permission(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    server = await make_server(owner, member)
    sid, chat = server["id"], text_channel(server)
    await say(owner, chat, "mensagem antiga")
    res = await owner.put(f"/channels/{chat}/overrides/role/{sid}", {"allow": 0, "deny": int(Perm.READ_HISTORY)})
    assert res.status_code == 200, res.text
    assert await search(member, sid, q="antiga") == []


async def test_only_members_can_search(client: AsyncClient) -> None:
    owner, outsider = await make_user(client, "owner"), await make_user(client, "outsider")
    server = await make_server(owner)
    await say(owner, text_channel(server), "oi")
    assert (await outsider.get(f"/servers/{server['id']}/search", params={"q": "oi"})).status_code == 404


async def test_filters_by_channel_author_and_date(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    server = await make_server(ana, bia)
    sid, chat = server["id"], text_channel(server)
    other = (await ana.post(f"/servers/{sid}/channels", {"name": "outro", "type": "text"})).json()["id"]
    old = await say(ana, chat, "reunião antiga")
    await say(bia, chat, "reunião da bia")
    await say(ana, other, "reunião no outro")
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE messages SET created_at = now() - interval '10 days' WHERE id = :i"), {"i": old["id"]})

    assert await search(ana, sid, q="reunião", channel_id=other) == ["reunião no outro"]
    assert await search(ana, sid, q="reunião", author_id=bia.id) == ["reunião da bia"]
    week_ago = (datetime.now(UTC) - timedelta(days=7)).isoformat()
    assert await search(ana, sid, q="reunião", until=week_ago) == ["reunião antiga"]
    assert "reunião antiga" not in await search(ana, sid, q="reunião", since=week_ago)


async def test_pages_with_before(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    server = await make_server(ana)
    sid, chat = server["id"], text_channel(server)
    for i in range(5):
        await say(ana, chat, f"teste {i}")
    first = (await ana.get(f"/servers/{sid}/search", params={"q": "teste", "limit": 2})).json()
    assert [m["content"] for m in first["messages"]] == ["teste 4", "teste 3"] and first["next_before"]
    second = (await ana.get(f"/servers/{sid}/search", params={"q": "teste", "limit": 2, "before": first["next_before"]})).json()
    assert [m["content"] for m in second["messages"]] == ["teste 2", "teste 1"]
    last = (await ana.get(f"/servers/{sid}/search", params={"q": "teste", "limit": 2, "before": second["next_before"]})).json()
    assert [m["content"] for m in last["messages"]] == ["teste 0"] and last["next_before"] is None
    assert (await ana.get(f"/servers/{sid}/search", params={"q": "teste", "limit": 51})).status_code == 422


async def test_an_empty_search_is_refused(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    server = await make_server(ana)
    for q in ("", "   "):
        assert (await ana.get(f"/servers/{server['id']}/search", params={"q": q})).status_code == 422
    # Odd input never breaks the query (websearch syntax is forgiving).
    assert await search(ana, server["id"], q='"aspas & | ! (') == []
