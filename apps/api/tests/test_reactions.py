"""Reactions: adding and taking back, live summary, permissions and limits."""

from urllib.parse import quote

from httpx import AsyncClient
from httpx_ws import aconnect_ws
from sqlalchemy import select

from app import bot
from app.db import SessionLocal
from app.models import User
from app.permissions import Perm
from app.reactions import MAX_EMOJIS, valid_emoji
from tests.helpers import ApiUser, make_server, make_user, text_channel, ws_client
from tests.test_bot import aureum, official_dm  # noqa: F401 (fixture)
from tests.test_calls import friends_dm
from tests.test_reads import say
from tests.test_ws import next_event, ws_url


def path(message_id: int, emoji: str) -> str:
    return f"/messages/{message_id}/reactions/{quote(emoji)}"


async def react(user: ApiUser, message_id: int, emoji: str):  # noqa: ANN201
    return await user.client.put(f"/api{path(message_id, emoji)}", headers=user.headers)


def test_what_counts_as_an_emoji() -> None:
    for emoji in ["🔥", "👍🏽", "❤️", "©️", "1️⃣", "🇧🇷", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "👨‍👩‍👧‍👦"]:
        assert valid_emoji(emoji), emoji
    for text in ["", "a", "ok", "1", "#", "<b>", "🔥 x", "x🔥", "🔥" * 17]:
        assert not valid_emoji(text), text


async def test_react_and_take_back_live(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    cid = text_channel(await make_server(ana, bia))
    message = await say(ana, cid, "bora?")

    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as ws:
        await next_event(ws, "ready")
        res = await react(bia, message["id"], "🔥")
        assert res.status_code == 200, res.text
        event = await next_event(ws, "message.reactions")
    assert event["message_id"] == message["id"] and event["channel_id"] == cid
    assert event["reactions"] == [{"emoji": "🔥", "count": 1, "user_ids": [bia.id]}]

    await react(ana, message["id"], "👍")
    await react(ana, message["id"], "🔥")
    assert (await react(ana, message["id"], "🔥")).status_code == 200  # twice is still once
    history = (await bia.get(f"/channels/{cid}/messages")).json()
    assert history[-1]["reactions"] == [
        {"emoji": "🔥", "count": 2, "user_ids": [bia.id, ana.id]},
        {"emoji": "👍", "count": 1, "user_ids": [ana.id]},
    ]
    res = await ana.delete(path(message["id"], "👍"))
    assert res.json() == [{"emoji": "🔥", "count": 2, "user_ids": [bia.id, ana.id]}]
    # Editing keeps them; a new message comes without the field (nothing to keep).
    edited = (await ana.patch(f"/messages/{message['id']}", {"content": "bora!"})).json()
    assert edited["reactions"][0]["count"] == 2
    assert (await say(ana, cid, "outra"))["reactions"] is None
    assert (await react(ana, message["id"], "ok")).status_code == 422


async def test_reaction_permissions(client: AsyncClient) -> None:
    owner, member, outsider = [await make_user(client, n) for n in ("owner", "member", "outsider")]
    server = await make_server(owner, member)
    sid, cid = server["id"], text_channel(server)
    message = await say(owner, cid, "votem")
    await react(owner, message["id"], "👍")

    await owner.put(f"/channels/{cid}/overrides/role/{sid}", {"deny": int(Perm.ADD_REACTIONS)})
    # No new emoji, but joining one already there is fine.
    assert (await react(member, message["id"], "🎉")).status_code == 403
    assert (await react(member, message["id"], "👍")).status_code == 200
    assert (await react(outsider, message["id"], "👍")).status_code == 404

    # Only MANAGE_MESSAGES removes other people's.
    assert (await member.delete(f"{path(message['id'], '👍')}/{owner.id}")).status_code == 403
    res = await owner.delete(f"{path(message['id'], '👍')}/{member.id}")
    assert res.status_code == 200 and res.json()[0]["user_ids"] == [owner.id]


async def test_at_most_20_different(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    cid = text_channel(await make_server(ana))
    message = await say(ana, cid, "muitas")
    emojis = [chr(0x1F600 + i) for i in range(MAX_EMOJIS + 1)]
    for emoji in emojis[:MAX_EMOJIS]:
        assert (await react(ana, message["id"], emoji)).status_code == 200
    assert (await react(ana, message["id"], emojis[-1])).status_code == 422
    # Adding to an emoji already there is fine at the limit.
    assert (await react(ana, message["id"], emojis[0])).status_code == 200


async def test_reactions_in_dms(client: AsyncClient, aureum) -> None:  # noqa: ANN001, F811
    ana, bia, dm = await friends_dm(client)
    message = (await ana.post(f"/channels/{dm['id']}/messages", {"content": "oi"})).json()
    assert (await react(bia, message["id"], "❤️")).status_code == 200
    # After an unfriend the DM stays readable, but takes no new reactions (like messages).
    assert (await bia.delete(f"/friends/{ana.id}")).status_code == 204
    assert (await react(bia, message["id"], "😢")).status_code == 403

    # The official DM is read-only, but takes reactions.
    async with SessionLocal() as session:
        user = await session.scalar(select(User).where(User.id == ana.id))
        assert await bot.send_dm(session, user, "avisos", "Olá!")
    official = await official_dm(ana)
    notice = (await ana.get(f"/channels/{official['id']}/messages")).json()[-1]
    assert (await react(ana, notice["id"], "👍")).status_code == 200
