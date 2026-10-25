"""The polls addon: created from any chat, votes, deadlines, anonymity, closing, permissions."""

from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient
from httpx_ws import aconnect_ws
from sqlalchemy import func, select, update

from app.addons.polls.models import Poll, PollVote
from app.addons.polls.router import close_due
from app.db import SessionLocal
from app.models import Message
from app.permissions import Perm
from tests.helpers import ApiUser, make_server, make_user, text_channel, ws_client
from tests.test_dms import open_dm
from tests.test_friends import befriend
from tests.test_ws import next_event, no_event, ws_url


def url(cid: str, path: str = "") -> str:
    return f"/addons/polls/channels/{cid}/polls{path}"


async def create(user: ApiUser, cid: str, options: list[str] = ["Pizza", "Sushi"], **body: Any) -> dict[str, Any]:
    res = await user.post(url(cid), {"question": "Jantar?", "options": [{"text": o} for o in options], **body})
    assert res.status_code == 201, res.text
    return res.json()


async def get(user: ApiUser, cid: str, poll_id: str) -> dict[str, Any]:
    res = await user.get(url(cid), params={"ids": [poll_id]})
    assert res.status_code == 200, res.text
    [poll] = res.json()
    return poll


async def vote(user: ApiUser, cid: str, poll: dict[str, Any], *texts: str) -> Any:
    ids = [o["id"] for o in poll["options"] if o["text"] in texts]
    return await user.put(url(cid, f"/{poll['id']}/vote"), {"option_ids": ids})


def counts(poll: dict[str, Any]) -> dict[str, int]:
    return {o["text"]: o["votes"] for o in poll["options"]}


async def expire(poll_id: str) -> None:
    async with SessionLocal() as session:
        await session.execute(update(Poll).where(Poll.id == poll_id).values(closes_at=datetime.now(UTC) - timedelta(seconds=1)))
        await session.commit()


async def last_message(user: ApiUser, cid: str) -> dict[str, Any]:
    return (await user.get(f"/channels/{cid}/messages")).json()[-1]


async def test_a_poll_is_a_message_in_the_chat(client: AsyncClient) -> None:
    owner, member = await make_user(client, "owner"), await make_user(client, "member")
    server = await make_server(owner, member)
    cid = text_channel(server)
    res = await member.post(
        url(cid),
        {
            "question": "  Onde jantar?  ",
            "options": [{"text": "Pizza", "emoji": "🍕"}, {"text": "Sushi"}],
            "duration": "24h",
        },
    )
    assert res.status_code == 201, res.text
    poll = res.json()
    assert poll["question"] == "Onde jantar?" and poll["created_by"] == member.id
    assert [(o["text"], o["emoji"], o["votes"]) for o in poll["options"]] == [("Pizza", "🍕", 0), ("Sushi", None, 0)]
    assert poll["multiple"] is False and poll["anonymous"] is False and poll["closed"] is False
    closes = datetime.fromisoformat(poll["closes_at"])
    assert timedelta(hours=23) < closes - datetime.now(UTC) <= timedelta(hours=24)

    # The message carries it; older apps show the fallback text, and nobody edits it as text.
    message = await last_message(owner, cid)
    assert message["id"] == poll["message_id"] and message["author"]["id"] == member.id
    assert message["embed"] == {"addon_key": "polls", "id": poll["id"]}
    assert message["content"] == "📊 Enquete: Onde jantar?"
    assert (await member.patch(f"/messages/{message['id']}", {"content": "x"})).status_code == 400
    assert (await get(owner, cid, poll["id"]))["id"] == poll["id"]

    # Not an addon that becomes a channel.
    assert "polls" not in {a["key"] for a in (await owner.get("/addons")).json()}
    res = await owner.post(f"/servers/{server['id']}/channels", {"name": "x", "type": "addon", "addon_key": "polls"})
    assert res.status_code == 422


async def test_validation(client: AsyncClient) -> None:
    owner = await make_user(client, "owner")
    cid = text_channel(await make_server(owner))
    bad = [
        {"question": " ", "options": [{"text": "a"}, {"text": "b"}]},
        {"question": "x" * 301, "options": [{"text": "a"}, {"text": "b"}]},
        {"question": "Q", "options": [{"text": "a"}]},
        {"question": "Q", "options": [{"text": str(i)} for i in range(11)]},
        {"question": "Q", "options": [{"text": "Pizza"}, {"text": "pizza "}]},
        {"question": "Q", "options": [{"text": "a"}, {"text": "x" * 81}]},
        {"question": "Q", "options": [{"text": "a"}, {"text": "b"}], "duration": "2h"},
    ]
    for body in bad:
        assert (await owner.post(url(cid), body)).status_code == 422, body
    # A voice channel holds no messages.
    voice = (await owner.post(f"/servers/{(await owner.get('/servers')).json()[0]['id']}/channels", {"name": "v", "type": "voice"})).json()
    assert (await owner.post(url(voice["id"]), {"question": "Q", "options": [{"text": "a"}, {"text": "b"}]})).status_code == 400


async def test_single_choice_votes(client: AsyncClient) -> None:
    owner, ana, bia = [await make_user(client, n) for n in ("owner", "ana", "bia")]
    cid = text_channel(await make_server(owner, ana, bia))
    poll = await create(owner, cid, ["Pizza", "Sushi", "Taco"])

    res = await vote(ana, cid, poll, "Pizza")
    assert res.status_code == 200
    mine = res.json()
    assert counts(mine) == {"Pizza": 1, "Sushi": 0, "Taco": 0} and mine["total_voters"] == 1
    assert mine["my_votes"] == [poll["options"][0]["id"]]
    assert mine["options"][0]["voter_ids"] == [ana.id]

    # Changing the vote replaces it.
    await vote(bia, cid, poll, "Pizza")
    after = (await vote(ana, cid, poll, "Sushi")).json()
    assert counts(after) == {"Pizza": 1, "Sushi": 1, "Taco": 0} and after["total_voters"] == 2
    # Only one option in a single-choice poll, and only its own options.
    assert (await vote(ana, cid, poll, "Pizza", "Taco")).status_code == 422
    other = await create(owner, cid)
    res = await ana.put(url(cid, f"/{poll['id']}/vote"), {"option_ids": [other["options"][0]["id"]]})
    assert res.status_code == 422
    # Empty takes it back.
    res = await ana.put(url(cid, f"/{poll['id']}/vote"), {"option_ids": []})
    assert res.json()["my_votes"] == [] and counts(res.json())["Sushi"] == 0
    seen = await get(bia, cid, poll["id"])
    assert seen["my_votes"] == [poll["options"][0]["id"]] and seen["total_voters"] == 1


async def test_multiple_choice_counts_people_once(client: AsyncClient) -> None:
    owner, ana = await make_user(client, "owner"), await make_user(client, "ana")
    cid = text_channel(await make_server(owner, ana))
    poll = await create(owner, cid, ["Seg", "Ter", "Qua"], multiple=True)
    mine = (await vote(ana, cid, poll, "Seg", "Qua")).json()
    assert counts(mine) == {"Seg": 1, "Ter": 0, "Qua": 1} and mine["total_voters"] == 1
    assert len(mine["my_votes"]) == 2
    mine = (await vote(ana, cid, poll, "Ter")).json()
    assert counts(mine) == {"Seg": 0, "Ter": 1, "Qua": 0}


async def test_anonymous_polls_never_say_who_voted(client: AsyncClient) -> None:
    owner, ana, bia = [await make_user(client, n) for n in ("owner", "ana", "bia")]
    cid = text_channel(await make_server(owner, ana, bia))
    poll = await create(owner, cid, anonymous=True)

    async with ws_client() as wsc, aconnect_ws(ws_url(bia), wsc) as bws, aconnect_ws(ws_url(ana), wsc) as aws:
        await next_event(bws, "ready")
        await next_event(aws, "ready")
        mine = (await vote(ana, cid, poll, "Pizza")).json()
        assert mine["my_votes"] == [poll["options"][0]["id"]]
        assert all(o["voter_ids"] is None for o in mine["options"])
        # Everyone gets the counts, without anyone's votes or names.
        event = await next_event(bws, "addon.polls.updated")
        assert counts(event) == {"Pizza": 1, "Sushi": 0} and "my_votes" not in event
        assert all(o["voter_ids"] is None for o in event["options"])
        # Only the voter learns their own choice.
        await no_event(bws, "addon.polls.voted")
        voted = await next_event(aws, "addon.polls.voted")
        assert voted == {"channel_id": cid, "server_id": voted["server_id"], "id": poll["id"], "my_votes": mine["my_votes"]}

    # Not the creator either, nor a moderator.
    for user in (owner, bia):
        seen = await get(user, cid, poll["id"])
        assert seen["my_votes"] == [] and all(o["voter_ids"] is None for o in seen["options"])
        assert counts(seen)["Pizza"] == 1


async def test_deadline_closes_the_poll(client: AsyncClient) -> None:
    owner, ana = await make_user(client, "owner"), await make_user(client, "ana")
    cid = text_channel(await make_server(owner, ana))
    poll = await create(owner, cid, duration="1h")
    await vote(ana, cid, poll, "Sushi")
    await expire(poll["id"])

    # Closed as soon as the deadline passes, even before the worker runs.
    assert (await get(ana, cid, poll["id"]))["closed"] is True
    assert (await vote(ana, cid, poll, "Pizza")).status_code == 409

    async with ws_client() as wsc, aconnect_ws(ws_url(ana), wsc) as aws:
        await next_event(aws, "ready")
        assert await close_due() == 1
        assert (await next_event(aws, "addon.polls.updated"))["closed_at"] is not None
        line = await next_event(aws, "message.created")
    assert line["system"]["lines"] == ["Enquete “Jantar?” encerrada: Sushi venceu"]
    assert line["system"]["standalone"] is True and line["system"]["message_id"] == poll["message_id"]
    assert line["author"]["id"] == owner.id
    # Only once.
    assert await close_due() == 0
    closed = await get(owner, cid, poll["id"])
    assert closed["closed_at"] is not None and counts(closed) == {"Pizza": 0, "Sushi": 1}


async def test_closing_by_hand(client: AsyncClient) -> None:
    owner, ana, bia = [await make_user(client, n) for n in ("owner", "ana", "bia")]
    cid = text_channel(await make_server(owner, ana, bia))
    poll = await create(ana, cid)
    await vote(ana, cid, poll, "Pizza")
    await vote(bia, cid, poll, "Sushi")

    # Not by another member; by whoever created it.
    assert (await bia.post(url(cid, f"/{poll['id']}/close"))).status_code == 403
    res = await ana.post(url(cid, f"/{poll['id']}/close"))
    assert res.status_code == 200 and res.json()["closed"] is True
    assert (await last_message(owner, cid))["system"]["lines"] == ["Enquete “Jantar?” encerrada: empate entre Pizza e Sushi"]
    assert (await ana.post(url(cid, f"/{poll['id']}/close"))).status_code == 409
    assert (await vote(bia, cid, poll, "Pizza")).status_code == 409

    # Who can manage messages closes anyone's; a poll without votes says so.
    other = await create(bia, cid)
    assert (await owner.post(url(cid, f"/{other['id']}/close"))).status_code == 200
    line = await last_message(owner, cid)
    assert line["system"]["lines"] == ["Enquete “Jantar?” encerrada sem votos"] and line["author"]["id"] == owner.id


async def test_permissions(client: AsyncClient) -> None:
    owner, member, outsider = [await make_user(client, n) for n in ("owner", "member", "outsider")]
    server = await make_server(owner, member)
    sid, cid = server["id"], text_channel(server)
    poll = await create(owner, cid)

    # Outside the server it doesn't exist.
    assert (await outsider.get(url(cid), params={"ids": [poll["id"]]})).status_code == 404
    assert (await vote(outsider, cid, poll, "Pizza")).status_code == 404

    # Without SEND_MESSAGES: no new polls, but votes still count.
    await owner.put(f"/channels/{cid}/overrides/role/{sid}", {"deny": int(Perm.SEND_MESSAGES)})
    res = await member.post(url(cid), {"question": "Q", "options": [{"text": "a"}, {"text": "b"}]})
    assert res.status_code == 403
    assert (await vote(member, cid, poll, "Pizza")).status_code == 200

    # Without seeing the channel, nothing.
    await owner.put(f"/channels/{cid}/overrides/role/{sid}", {"deny": int(Perm.VIEW_CHANNEL)})
    assert (await vote(member, cid, poll, "Sushi")).status_code == 404

    # A poll of another chat isn't found through this one.
    other_cid = (await owner.post(f"/servers/{sid}/channels", {"name": "outro"})).json()["id"]
    assert (await owner.get(url(other_cid), params={"ids": [poll["id"]]})).json() == []
    assert (await vote(owner, other_cid, poll, "Pizza")).status_code == 404


async def test_polls_in_dms_and_groups(client: AsyncClient) -> None:
    ana, bia, cai = [await make_user(client, n) for n in ("ana", "bia", "cai")]
    await befriend(ana, bia)
    await befriend(ana, cai)
    dm = await open_dm(ana, bia)
    poll = await create(ana, dm["id"])
    assert (await vote(bia, dm["id"], poll, "Sushi")).status_code == 200
    # Someone outside the conversation can't see it.
    assert (await vote(cai, dm["id"], poll, "Sushi")).status_code == 404
    # In DMs nobody moderates: only whoever created it closes it.
    assert (await bia.post(url(dm["id"], f"/{poll['id']}/close"))).status_code == 403

    group = (await ana.post("/dms/groups", {"user_ids": [bia.id, cai.id]})).json()
    gpoll = await create(cai, group["id"], multiple=True)
    assert (await vote(ana, group["id"], gpoll, "Pizza", "Sushi")).status_code == 200

    # A 1:1 DM is only written to by friends: no new polls after an unfriend.
    assert (await ana.delete(f"/friends/{bia.id}")).status_code in (200, 204)
    res = await bia.post(url(dm["id"]), {"question": "Q", "options": [{"text": "a"}, {"text": "b"}]})
    assert res.status_code == 403


async def test_deleting_the_message_deletes_the_poll(client: AsyncClient) -> None:
    owner, ana = await make_user(client, "owner"), await make_user(client, "ana")
    cid = text_channel(await make_server(owner, ana))
    poll = await create(ana, cid)
    await vote(ana, cid, poll, "Pizza")
    # A moderator can delete it like any message.
    assert (await owner.delete(f"/messages/{poll['message_id']}")).status_code == 204
    assert (await owner.get(url(cid), params={"ids": [poll["id"]]})).json() == []
    async with SessionLocal() as session:
        assert await session.scalar(select(func.count()).select_from(PollVote)) == 0
        assert await session.scalar(select(func.count()).select_from(Message).where(Message.id == poll["message_id"])) == 0
