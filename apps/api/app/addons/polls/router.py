import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, StringConstraints, field_validator
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.addons.base import AddonChat, AddonManifest, addon_chat
from app.addons.polls.models import Poll, PollOption, PollVote
from app.db import SessionLocal
from app.deps import CurrentUser, SessionDep
from app.models import Channel, Message

log = logging.getLogger(__name__)

MIN_OPTIONS = 2
MAX_OPTIONS = 10
# How often the worker looks for polls whose deadline passed.
POLL_SECONDS = 20
DURATIONS = {
    "1h": timedelta(hours=1),
    "8h": timedelta(hours=8),
    "24h": timedelta(hours=24),
    "3d": timedelta(days=3),
    "1w": timedelta(weeks=1),
}

router = APIRouter()

Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
OptionText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Emoji = Annotated[str, StringConstraints(strip_whitespace=True, max_length=16)]


# --- Schemas --------------------------------------------------------------------


class OptionIn(BaseModel):
    text: OptionText
    emoji: Emoji | None = None


class PollCreate(BaseModel):
    question: Question
    options: Annotated[list[OptionIn], Field(min_length=MIN_OPTIONS, max_length=MAX_OPTIONS)]
    multiple: bool = False
    anonymous: bool = False
    # None: open until someone closes it.
    duration: Literal["1h", "8h", "24h", "3d", "1w"] | None = None

    @field_validator("options")
    @classmethod
    def _distinct(cls, options: list[OptionIn]) -> list[OptionIn]:
        if len({o.text.casefold() for o in options}) != len(options):
            raise ValueError("Options must be different")
        return options


class Vote(BaseModel):
    # Empty takes the vote back. More than one only in a multiple-choice poll.
    option_ids: Annotated[list[uuid.UUID], Field(max_length=MAX_OPTIONS)]


class OptionOut(BaseModel):
    id: uuid.UUID
    text: str
    emoji: str | None
    votes: int
    # Who picked it; always None in an anonymous poll, for everyone (its creator too).
    voter_ids: list[uuid.UUID] | None


class PollOut(BaseModel):
    id: uuid.UUID
    channel_id: uuid.UUID
    message_id: int
    question: str
    options: list[OptionOut]
    multiple: bool
    anonymous: bool
    closes_at: datetime | None
    closed_at: datetime | None
    # Closed by hand or because its deadline passed (the system line may come a little later).
    closed: bool
    # People who voted (in a multiple-choice poll, one person counts once).
    total_voters: int
    created_by: uuid.UUID | None


class MyPoll(PollOut):
    """A poll as one person sees it. Live updates go to everyone as PollOut; each person's own
    votes come in `addon.polls.voted`, to them only."""

    my_votes: list[uuid.UUID]


# --- Helpers --------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(UTC)


def _is_closed(poll: Poll) -> bool:
    return poll.closed_at is not None or (poll.closes_at is not None and poll.closes_at <= _now())


async def _options(session: AsyncSession, poll_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[PollOption]]:
    rows = await session.scalars(select(PollOption).where(PollOption.poll_id.in_(poll_ids)).order_by(PollOption.position))
    out: dict[uuid.UUID, list[PollOption]] = {}
    for option in rows:
        out.setdefault(option.poll_id, []).append(option)
    return out


async def _outs(session: AsyncSession, polls: list[Poll], user_id: uuid.UUID | None = None) -> list[MyPoll]:
    """The polls with their counts; `my_votes` is the user's (empty without one)."""
    if not polls:
        return []
    ids = [p.id for p in polls]
    options = await _options(session, ids)
    votes = (await session.execute(select(PollVote.poll_id, PollVote.option_id, PollVote.user_id).where(PollVote.poll_id.in_(ids)))).all()
    by_option: dict[uuid.UUID, list[uuid.UUID]] = {}
    voters: dict[uuid.UUID, set[uuid.UUID]] = {}
    mine: dict[uuid.UUID, list[uuid.UUID]] = {}
    for poll_id, option_id, voter in votes:
        by_option.setdefault(option_id, []).append(voter)
        voters.setdefault(poll_id, set()).add(voter)
        if voter == user_id:
            mine.setdefault(poll_id, []).append(option_id)
    return [
        MyPoll(
            id=p.id,
            channel_id=p.workspace_id,
            message_id=p.message_id,
            question=p.question,
            options=[
                OptionOut(
                    id=o.id,
                    text=o.text,
                    emoji=o.emoji,
                    votes=len(by_option.get(o.id, [])),
                    voter_ids=None if p.anonymous else by_option.get(o.id, []),
                )
                for o in options.get(p.id, [])
            ],
            multiple=p.multiple,
            anonymous=p.anonymous,
            closes_at=p.closes_at,
            closed_at=p.closed_at,
            closed=_is_closed(p),
            total_voters=len(voters.get(p.id, ())),
            created_by=p.created_by,
            my_votes=mine.get(p.id, []),
        )
        for p in polls
    ]


async def _poll(session: AsyncSession, chat: AddonChat, poll_id: uuid.UUID, *, lock: bool = False) -> Poll:
    query = select(Poll).where(Poll.id == poll_id, Poll.workspace_id == chat.workspace_id)
    poll = await session.scalar(query.with_for_update() if lock else query)
    if poll is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Poll not found")
    return poll


async def _publish(chat: AddonChat, poll: Poll) -> None:
    """The new counts to everyone in the chat (without anyone's own votes)."""
    [out] = await _outs(chat.session, [poll])
    await chat.publish("updated", out.model_dump(mode="json", exclude={"my_votes"}))


def _result_line(poll: Poll, options: list[OptionOut]) -> str:
    """"Enquete “X” encerrada: Pizza venceu" (or a tie, or no votes)."""
    top = max((o.votes for o in options), default=0)
    head = f"Enquete “{poll.question}” encerrada"
    if top == 0:
        return f"{head} sem votos"
    names = [f"{o.emoji} {o.text}" if o.emoji else o.text for o in options if o.votes == top]
    if len(names) == 1:
        return f"{head}: {names[0]} venceu"
    return f"{head}: empate entre {', '.join(names[:-1])} e {names[-1]}"


async def _closed(chat: AddonChat, poll: Poll) -> None:
    """After a poll closes (committed): the new state and the result line."""
    [out] = await _outs(chat.session, [poll])
    await chat.publish("updated", out.model_dump(mode="json", exclude={"my_votes"}))
    author = poll.closed_by or poll.created_by
    await chat.system_line(_result_line(poll, out.options), author_id=author, message_id=poll.message_id)


async def _claim_close(session: AsyncSession, poll_id: uuid.UUID, at: datetime, by: uuid.UUID | None) -> bool:
    """Closes the poll unless something else already did: only one closing posts the result."""
    claimed = await session.scalar(
        update(Poll)
        .where(Poll.id == poll_id, Poll.closed_at.is_(None))
        .values(closed_at=at, closed_by=by)
        .returning(Poll.id)
    )
    await session.commit()
    return claimed is not None


async def close_due() -> int:
    """Closes the polls whose deadline passed and posts their results. Returns how many."""
    async with SessionLocal() as session:
        due = list(
            await session.scalars(
                select(Poll).where(Poll.closed_at.is_(None), Poll.closes_at.is_not(None), Poll.closes_at <= _now()).limit(50)
            )
        )
        closed = 0
        for poll in due:
            assert poll.closes_at is not None
            if not await _claim_close(session, poll.id, poll.closes_at, None):
                continue
            await session.refresh(poll)
            channel = await session.get(Channel, poll.workspace_id)
            if channel is None:
                continue
            chat = AddonChat(manifest, channel, None, session, None)
            try:
                await _closed(chat, poll)
            except Exception:
                log.exception("Polls: could not announce the result of %s", poll.id)
            closed += 1
        return closed


async def run_worker() -> None:
    while True:
        try:
            while await close_due():
                pass
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Polls: deadline worker failed; trying again shortly")
        await asyncio.sleep(POLL_SECONDS)


# --- Routes ---------------------------------------------------------------------


@router.post("/channels/{channel_id}/polls", response_model=MyPoll, status_code=status.HTTP_201_CREATED)
async def create_poll(channel_id: uuid.UUID, body: PollCreate, user: CurrentUser, session: SessionDep) -> MyPoll:
    """Posts the poll as a message by the user, who must be able to send messages here."""
    chat = await addon_chat(session, manifest, channel_id, user.id)
    await chat.require_send()
    poll = Poll(
        id=uuid.uuid4(),
        workspace_id=chat.workspace_id,
        question=body.question,
        multiple=body.multiple,
        anonymous=body.anonymous,
        closes_at=_now() + DURATIONS[body.duration] if body.duration else None,
        created_by=user.id,
    )
    options = [PollOption(poll_id=poll.id, position=i, text=o.text, emoji=o.emoji or None) for i, o in enumerate(body.options)]

    def link(message: Message) -> None:
        poll.message_id = message.id
        session.add(poll)
        session.add_all(options)

    await chat.post(poll.id, f"📊 Enquete: {poll.question}", on_saved=link)
    [out] = await _outs(session, [poll], user.id)
    return out


@router.get("/channels/{channel_id}/polls", response_model=list[MyPoll])
async def get_polls(
    channel_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
    ids: Annotated[list[uuid.UUID], Query(max_length=50)],
) -> list[MyPoll]:
    """The polls of these ids in this chat, as the user sees them (unknown ids are left out)."""
    chat = await addon_chat(session, manifest, channel_id, user.id)
    polls = list(await session.scalars(select(Poll).where(Poll.workspace_id == chat.workspace_id, Poll.id.in_(ids))))
    return await _outs(session, polls, user.id)


@router.put("/channels/{channel_id}/polls/{poll_id}/vote", response_model=MyPoll)
async def vote(channel_id: uuid.UUID, poll_id: uuid.UUID, body: Vote, user: CurrentUser, session: SessionDep) -> MyPoll:
    """Sets the user's vote (replacing the previous one) while the poll is open. Whoever can see
    the chat can vote."""
    chat = await addon_chat(session, manifest, channel_id, user.id)
    poll = await _poll(session, chat, poll_id, lock=True)
    if _is_closed(poll):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This poll is closed")
    picked = list(dict.fromkeys(body.option_ids))
    if len(picked) > 1 and not poll.multiple:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Pick one option")
    valid = {o.id for o in (await _options(session, [poll.id])).get(poll.id, [])}
    if not set(picked) <= valid:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown option")
    await session.execute(delete(PollVote).where(PollVote.poll_id == poll.id, PollVote.user_id == user.id))
    session.add_all([PollVote(poll_id=poll.id, option_id=o, user_id=user.id) for o in picked])
    await session.commit()
    [out] = await _outs(session, [poll], user.id)
    await chat.publish("updated", out.model_dump(mode="json", exclude={"my_votes"}))
    # The user's other devices: their own choice (an anonymous poll doesn't say who voted).
    await chat.publish("voted", {"id": str(poll.id), "my_votes": [str(o) for o in out.my_votes]}, [user.id])
    return out


@router.post("/channels/{channel_id}/polls/{poll_id}/close", response_model=MyPoll)
async def close_poll(channel_id: uuid.UUID, poll_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> MyPoll:
    """Before the deadline: by whoever created it, or by who can manage messages here."""
    chat = await addon_chat(session, manifest, channel_id, user.id)
    poll = await _poll(session, chat, poll_id)
    if poll.created_by != user.id and not chat.can_moderate:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only who created the poll can close it")
    if _is_closed(poll):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This poll is closed")
    if await _claim_close(session, poll.id, _now(), user.id):
        await session.refresh(poll)
        await _closed(chat, poll)
    await session.refresh(poll)
    [out] = await _outs(session, [poll], user.id)
    return out


manifest = AddonManifest(
    key="polls",
    name="Enquetes",
    description="Perguntas com opções para o grupo votar, direto no chat.",
    icon="chart-bar",
    router=router,
    worker=run_worker,
    in_channel=False,
)
