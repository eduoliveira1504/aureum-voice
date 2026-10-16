"""Private calls in DMs and groups.

Starting a call creates a `calls` row, rings the other members (`call.ringing`) and leaves a
line in the conversation. People join through the regular voice flow (voice.update over the
WebSocket and a LiveKit token), with the conversation as the voice scope. A ring times out
after RING_SECONDS on the clients; a participant rung but never joined nor declined then counts
as a missed call. The call ends when its last participant leaves.

Adding someone to a call in a group adds them to the group. In a 1:1 DM it can't (that would
show them the DM's history), so a new group is created with everyone and the call moves there:
the people in the old call get `call.moved` and switch over.
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import dms, reads, social, voice
from app.access import channel_member_ids
from app.db import SessionLocal
from app.models import Call, CallParticipant, Channel, ChannelMember, ChannelRead, ChannelType, Message
from app.realtime import broker
from app.schemas import MAX_GROUP_MEMBERS, CallOut, MessageOut

RING_SECONDS = 30
# A call nobody joined within this time is over (the caller's app failed to connect, say).
EMPTY_GRACE_SECONDS = 60


def _now() -> datetime:
    return datetime.now(UTC)


async def active_call(session: AsyncSession, channel_id: uuid.UUID) -> Call | None:
    return await session.scalar(select(Call).where(Call.channel_id == channel_id, Call.ended_at.is_(None)))


async def current_calls(session: AsyncSession, channel_ids: list[uuid.UUID]) -> dict[uuid.UUID, Call]:
    """Active calls by channel id, ending abandoned ones on the way."""
    if not channel_ids:
        return {}
    rows = list(await session.scalars(select(Call).where(Call.channel_id.in_(channel_ids), Call.ended_at.is_(None))))
    out = {}
    for call in rows:
        if await _abandoned(call):
            await _end(session, call)
        else:
            out[call.channel_id] = call
    return out


async def current_call(session: AsyncSession, channel_id: uuid.UUID) -> Call | None:
    return (await current_calls(session, [channel_id])).get(channel_id)


async def _abandoned(call: Call) -> bool:
    started_long_ago = call.started_at < _now() - timedelta(seconds=EMPTY_GRACE_SECONDS)
    return started_long_ago and not await voice.get_states(voice.dm_scope(call.channel_id))


async def _end(session: AsyncSession, call: Call) -> None:
    call.ended_at = _now()
    await session.commit()
    await publish(session, call)
    await _publish_line(session, call, "message.updated")


def _participant(call: Call, user_id: uuid.UUID) -> CallParticipant | None:
    return next((p for p in call.participants if p.user_id == user_id), None)


async def publish(session: AsyncSession, call: Call, type_: str = "call.updated", to: list[uuid.UUID] | None = None) -> None:
    await session.refresh(call, ["participants"])
    recipients = to if to is not None else await channel_member_ids(session, call.channel_id)
    await broker.publish(type_, CallOut.model_validate(call).model_dump(mode="json"), recipients)


async def _publish_line(session: AsyncSession, call: Call, type_: str) -> None:
    """The call's line in the conversation (created when it starts, updated when it ends)."""
    line = await session.scalar(select(Message).where(Message.call_id == call.id))
    if line is None:
        return
    await session.refresh(line, ["author", "call"])
    out = MessageOut.model_validate(line).model_dump(mode="json")
    if type_ == "message.created":
        out = {**out, "server_id": None, "mentions": []}
    await broker.publish(type_, out, await channel_member_ids(session, call.channel_id))


async def _ringable(session: AsyncSession, caller: uuid.UUID, user_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    """Who of these the caller may ring: not themselves, and no block either way."""
    blocked = await social.blocked_by_or_blocking(session, caller)
    return [u for u in user_ids if u != caller and u not in blocked]


async def _open(session: AsyncSession, channel: Channel, caller: uuid.UUID, present: list[uuid.UUID]) -> Call:
    """Creates the call row, its participants and its line (not committed). `present` are
    already in the call elsewhere (moved over), so they aren't rung."""
    members = await channel_member_ids(session, channel.id)
    ring = await _ringable(session, caller, [m for m in members if m not in present])
    call = Call(channel_id=channel.id, started_by=caller)
    session.add(call)
    await session.flush()
    now = _now()
    for user_id in dict.fromkeys([caller, *present]):
        session.add(CallParticipant(call_id=call.id, user_id=user_id))
    for user_id in ring:
        session.add(CallParticipant(call_id=call.id, user_id=user_id, rung_at=now))
    session.add(Message(channel_id=channel.id, author_id=caller, content="", attachments=[], call_id=call.id))
    return call


async def _announce_start(session: AsyncSession, channel: Channel, call: Call) -> None:
    await dms.reveal(session, channel)
    await _publish_line(session, call, "message.created")
    await publish(session, call)
    await session.refresh(call, ["participants"])
    rung = [p.user_id for p in call.participants if p.rung_at is not None]
    await publish(session, call, "call.ringing", rung)


async def start(session: AsyncSession, channel: Channel, caller: uuid.UUID) -> tuple[Call, bool]:
    """Starts a call in the conversation, or returns the one in progress. (call, created)"""
    existing = await current_call(session, channel.id)
    if existing is not None:
        return existing, False
    if channel.type == ChannelType.dm:
        other = next(u for u in await channel_member_ids(session, channel.id) if u != caller)
        if not await social.are_friends(session, caller, other):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can only call your friends")
    call = await _open(session, channel, caller, present=[])
    try:
        await session.commit()
    except IntegrityError:  # someone else started one at the same moment: use theirs
        await session.rollback()
        existing = await active_call(session, channel.id)
        assert existing is not None
        return existing, False
    await _announce_start(session, channel, call)
    return call, True


async def ring(session: AsyncSession, call: Call, inviter: uuid.UUID, user_ids: list[uuid.UUID]) -> Call:
    """Rings more people into a call: friends from outside get added to the group (in a 1:1
    DM, the call moves to a new group). Returns the call they are rung for."""
    channel = await session.get(Channel, call.channel_id)
    assert channel is not None
    members = await channel_member_ids(session, channel.id)
    outsiders = [u for u in dict.fromkeys(user_ids) if u not in members and u != inviter]
    if outsiders:
        friends = await social.friend_ids(session, inviter)
        if any(u not in friends for u in outsiders):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can only add your friends")
        if len(members) + len(outsiders) > MAX_GROUP_MEMBERS:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Groups hold up to {MAX_GROUP_MEMBERS} people")
        if channel.type == ChannelType.dm:
            return await _move_to_group(session, call, channel, inviter, [*members, *outsiders])
        for user_id in outsiders:
            session.add(ChannelMember(channel_id=channel.id, user_id=user_id))
            await reads.seed_channel(session, user_id, channel.id)

    now = _now()
    rung = []
    for user_id in await _ringable(session, inviter, [*dict.fromkeys(user_ids)]):
        p = _participant(call, user_id)
        if p is None:
            session.add(CallParticipant(call_id=call.id, user_id=user_id, rung_at=now))
        elif p.joined_at is None or p.left_at is not None:  # not in the call right now
            p.rung_at, p.declined_at = now, None
        else:
            continue
        rung.append(user_id)
    await session.commit()
    if outsiders:
        await dms.announce(session, channel, outsiders, "dm.created")
        await dms.announce(session, channel, members)
    await dms.reveal(session, channel)
    await publish(session, call)
    await publish(session, call, "call.ringing", rung)
    return call


async def _move_to_group(
    session: AsyncSession, call: Call, dm: Channel, inviter: uuid.UUID, everyone: list[uuid.UUID]
) -> Call:
    group = Channel(type=ChannelType.group_dm)
    session.add(group)
    await session.flush()
    for user_id in everyone:
        session.add(ChannelMember(channel_id=group.id, user_id=user_id))
    present = [s.user_id for s in await voice.get_states(voice.dm_scope(dm.id))]
    new_call = await _open(session, group, inviter, present)
    await session.commit()
    await dms.announce(session, group, everyone, "dm.created")
    await _announce_start(session, group, new_call)
    await session.refresh(new_call, ["participants"])
    moved = {"from_call_id": str(call.id), "call": CallOut.model_validate(new_call).model_dump(mode="json")}
    await broker.publish("call.moved", moved, present)
    return new_call


async def decline(session: AsyncSession, call: Call, user_id: uuid.UUID) -> None:
    p = _participant(call, user_id)
    if p is None or p.rung_at is None or p.joined_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="You're not being rung for this call")
    p.declined_at = _now()
    await session.commit()
    await publish(session, call)


async def joined(channel_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """The user entered the call's voice scope (after voice.set_state)."""
    async with SessionLocal() as session:
        call = await active_call(session, channel_id)
        if call is None:
            return
        p = _participant(call, user_id)
        if p is None:  # a member who wasn't rung (e.g. joined from the conversation)
            session.add(CallParticipant(call_id=call.id, user_id=user_id, joined_at=_now()))
        elif p.joined_at is None or p.left_at is not None:
            p.joined_at = p.joined_at or _now()
            p.left_at = p.declined_at = None
        else:
            return  # already in: just a mute/camera change
        await session.commit()
        await publish(session, call)


async def _on_left(scope: voice.Scope, user_id: uuid.UUID, remaining: int) -> None:
    if scope.kind != "dm":
        return
    async with SessionLocal() as session:
        call = await active_call(session, scope.id)
        if call is None:
            return
        p = _participant(call, user_id)
        if p is not None:
            p.left_at = _now()
        if remaining == 0:
            return await _end(session, call)
        await session.commit()
        await publish(session, call)


voice.on_left(_on_left)


async def missed(session: AsyncSession, user_id: uuid.UUID, limit: int = 50) -> list[Call]:
    """Calls the user was rung for and didn't answer nor decline, after the ring timed out,
    that they haven't seen yet (their call line is still unread)."""
    timed_out = _now() - timedelta(seconds=RING_SECONDS)
    rows = await session.scalars(
        select(Call)
        .join(CallParticipant, (CallParticipant.call_id == Call.id) & (CallParticipant.user_id == user_id))
        .join(Message, Message.call_id == Call.id)
        .outerjoin(ChannelRead, (ChannelRead.channel_id == Call.channel_id) & (ChannelRead.user_id == user_id))
        .where(
            CallParticipant.rung_at.is_not(None),
            CallParticipant.joined_at.is_(None),
            CallParticipant.declined_at.is_(None),
            or_(Call.ended_at.is_not(None), CallParticipant.rung_at < timed_out),
            Message.id > func.coalesce(ChannelRead.last_read_message_id, 0),
        )
        .order_by(Call.started_at.desc())
        .limit(limit)
    )
    return list(rows)
