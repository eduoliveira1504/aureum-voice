"""Daily games on Home (block 4.2.10): today's puzzle, checking an answer, and the summary for
Home's card (results, streak, friends who played today). See app/daily."""

import time
import uuid
from datetime import date, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import daily, ratelimit, social
from app.access import channel_audience
from app.config import get_settings
from app.deps import CurrentUser, SessionDep
from app.messages import chat_channel, post_message, require_dm_friends
from app.models import DailyPuzzle, DailyResult, DailyShare
from app.permissions import Perm
from app.realtime import broker

router = APIRouter(prefix="/daily", tags=["daily"])

# Checking an answer: plenty for a person, not for guessing by script.
CHECKS = (60, 60)
# Kept a little longer than a day, so a game started before midnight can still be finished.
TRACK_SECONDS = 2 * 24 * 60 * 60
# A streak shown for at most this many days back (the query stops there).
STREAK_DAYS = 400
# Sharing: a few channels at once, and not many times an hour.
SHARE_CHANNELS = 10
SHARES = (30, 60 * 60)


class ResultOut(BaseModel):
    game: str
    day: date
    time_ms: int
    attempts: int
    completed: bool


class RankEntry(BaseModel):
    user_id: uuid.UUID
    time_ms: int
    attempts: int


class PuzzleOut(BaseModel):
    game: str
    day: date
    puzzle: dict[str, Any]
    result: ResultOut | None = None
    # Today's results of the user and their friends in this game, best first.
    ranking: list[RankEntry] = []


class FriendPlayed(BaseModel):
    user_id: uuid.UUID
    games: list[str]


class DailySummary(BaseModel):
    day: date
    games: list[str]
    results: list[ResultOut]
    # Days in a row with at least one game finished, up to today (or yesterday, if not yet today).
    streak: int
    friends_today: list[FriendPlayed]
    # Per game: today's results of the user and their friends, best first (a challenge among friends).
    rankings: dict[str, list[RankEntry]] = {}


class Check(BaseModel):
    day: date
    answer: Any
    # What the app's clock says; never more than the time since the puzzle was opened.
    time_ms: Annotated[int, Field(ge=0, le=TRACK_SECONDS * 1000)]


class CheckOut(BaseModel):
    correct: bool
    result: ResultOut | None = None


class Share(BaseModel):
    day: date
    channel_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=SHARE_CHANNELS)]


class ShareOut(BaseModel):
    # Posted now.
    shared: list[uuid.UUID]
    # Already had this game's challenge for the day (one per channel).
    already: list[uuid.UUID]


def _track_key(kind: str, user_id: uuid.UUID, game: str, day: date) -> str:
    return f"{get_settings().redis_prefix}:daily:{kind}:{user_id}:{game}:{day.isoformat()}"


def _game(key: str) -> daily.DailyGame:
    game = daily.GAMES.get(key)
    if game is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Unknown game")
    return game


async def puzzle_of(session: AsyncSession, game: daily.DailyGame, day: date) -> DailyPuzzle:
    """The day's puzzle, made and saved by whoever asks first."""
    saved = await session.get(DailyPuzzle, (game.key, day))
    if saved is not None:
        return saved
    puzzle, solution = game.generate(daily.rng_for(game.key, day))
    await session.execute(
        insert(DailyPuzzle).values(game=game.key, day=day, puzzle=puzzle, solution=solution).on_conflict_do_nothing()
    )
    await session.commit()
    saved = await session.get(DailyPuzzle, (game.key, day))
    assert saved is not None
    return saved


def _out(result: DailyResult) -> ResultOut:
    return ResultOut(game=result.game, day=result.day, time_ms=result.time_ms, attempts=result.attempts, completed=result.completed)


async def rankings(session: AsyncSession, user_id: uuid.UUID, day: date, game: str | None = None) -> dict[str, list[RankEntry]]:
    """Per game, the day's finished results of the user and their friends: the shortest time
    first, then fewer attempts, then whoever finished first."""
    people = await social.friend_ids(session, user_id) | {user_id}
    query = select(DailyResult).where(DailyResult.user_id.in_(people), DailyResult.day == day, DailyResult.completed.is_(True))
    if game is not None:
        query = query.where(DailyResult.game == game)
    rows = await session.scalars(query.order_by(DailyResult.time_ms, DailyResult.attempts, DailyResult.created_at))
    out: dict[str, list[RankEntry]] = {}
    for r in rows:
        out.setdefault(r.game, []).append(RankEntry(user_id=r.user_id, time_ms=r.time_ms, attempts=r.attempts))
    return out


def streak_of(days: list[date], today: date) -> int:
    """Days in a row ending today, or yesterday when today has nothing yet."""
    played = set(days)
    day = today if today in played else today - timedelta(days=1)
    count = 0
    while day in played:
        count += 1
        day -= timedelta(days=1)
    return count


@router.get("", response_model=DailySummary)
async def summary(user: CurrentUser, session: SessionDep) -> DailySummary:
    today = daily.today()
    mine = list(
        await session.scalars(select(DailyResult).where(DailyResult.user_id == user.id, DailyResult.day == today))
    )
    days = list(
        await session.scalars(
            select(DailyResult.day)
            .where(DailyResult.user_id == user.id, DailyResult.completed.is_(True), DailyResult.day > today - timedelta(days=STREAK_DAYS))
            .distinct()
        )
    )
    friends = await social.friend_ids(session, user.id)
    played: dict[uuid.UUID, list[str]] = {}
    if friends:
        rows = await session.execute(
            select(DailyResult.user_id, DailyResult.game).where(DailyResult.user_id.in_(friends), DailyResult.day == today)
        )
        for friend_id, game in rows:
            played.setdefault(friend_id, []).append(game)
    return DailySummary(
        day=today,
        games=list(daily.GAMES),
        results=[_out(r) for r in mine],
        streak=streak_of(days, today),
        friends_today=[FriendPlayed(user_id=u, games=sorted(g)) for u, g in played.items()],
        rankings=await rankings(session, user.id, today),
    )


@router.get("/{game_key}", response_model=PuzzleOut)
async def today_puzzle(game_key: str, user: CurrentUser, session: SessionDep) -> PuzzleOut:
    game = _game(game_key)
    day = daily.today()
    saved = await puzzle_of(session, game, day)
    # When it was first opened: the time sent at the end can't be more than this allows.
    try:
        await broker.redis.set(_track_key("start", user.id, game.key, day), time.time(), nx=True, ex=TRACK_SECONDS)
    except Exception:  # noqa: BLE001 - without Redis the app's time is trusted
        pass
    result = await session.get(DailyResult, (user.id, game.key, day))
    ranking = (await rankings(session, user.id, day, game.key)).get(game.key, [])
    return PuzzleOut(game=game.key, day=day, puzzle=saved.puzzle, result=_out(result) if result else None, ranking=ranking)


@router.post("/{game_key}/check", response_model=CheckOut)
async def check_answer(game_key: str, body: Check, user: CurrentUser, session: SessionDep) -> CheckOut:
    """Right: saves the result (once) and returns it. Wrong: counts an attempt. A game opened
    yesterday can still be finished today, as yesterday's."""
    game = _game(game_key)
    today = daily.today()
    if body.day not in (today, today - timedelta(days=1)):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="That puzzle is no longer open")
    existing = await session.get(DailyResult, (user.id, game.key, body.day))
    if existing is not None:
        return CheckOut(correct=True, result=_out(existing))
    await ratelimit.hit(f"daily:{user.id}", *CHECKS)
    saved = await session.get(DailyPuzzle, (game.key, body.day))
    if saved is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Open the puzzle first")
    wrong_key = _track_key("wrong", user.id, game.key, body.day)
    if not game.check(saved.puzzle, saved.solution, body.answer):
        try:
            await broker.redis.incr(wrong_key)
            await broker.redis.expire(wrong_key, TRACK_SECONDS)
        except Exception:  # noqa: BLE001
            pass
        return CheckOut(correct=False)

    time_ms = body.time_ms
    wrong = 0
    try:
        started = await broker.redis.get(_track_key("start", user.id, game.key, body.day))
        if started is not None:
            time_ms = min(time_ms, int((time.time() - float(started)) * 1000) + 1000)
        wrong = int(await broker.redis.get(wrong_key) or 0)
    except Exception:  # noqa: BLE001
        pass
    await session.execute(
        insert(DailyResult)
        .values(user_id=user.id, game=game.key, day=body.day, time_ms=max(time_ms, 0), attempts=wrong + 1, completed=True)
        .on_conflict_do_nothing()
    )
    await session.commit()
    result = await session.get(DailyResult, (user.id, game.key, body.day))
    assert result is not None
    return CheckOut(correct=True, result=_out(result))


def challenge_text(game: daily.DailyGame, result: DailyResult) -> str:
    """What apps that don't know the games show: the result, never the answer."""
    seconds = result.time_ms // 1000
    tries = "1 tentativa" if result.attempts == 1 else f"{result.attempts} tentativas"
    return (
        f"Desafio do dia: {game.name} de {result.day.strftime('%d/%m')}. Fiz em {seconds // 60}:{seconds % 60:02d} "
        f"com {tries}. Consegue fazer melhor? Jogue em Jogos do dia, no Início do Aureum."
    )


@router.post("/{game_key}/share", response_model=ShareOut)
async def share(game_key: str, body: Share, user: CurrentUser, session: SessionDep) -> ShareOut:
    """Posts the user's result as a challenge in DMs, groups or server text channels they can
    write in. One challenge per game, day and channel: the card's ranking covers everyone there."""
    game = _game(game_key)
    result = await session.get(DailyResult, (user.id, game.key, body.day))
    if result is None or not result.completed:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Finish the game before sharing it")
    channel_ids = list(dict.fromkeys(body.channel_ids))
    channels = []
    for channel_id in channel_ids:
        channel, access = await chat_channel(session, channel_id, user.id)
        await require_dm_friends(session, channel, user.id)
        if access is not None:
            access.require_in(channel, Perm.SEND_MESSAGES)
        channels.append(channel)
    await ratelimit.hit(f"daily-share:{user.id}", *SHARES)
    shared, already = [], []
    for channel in channels:
        claimed = await session.scalar(
            insert(DailyShare)
            .values(game=game.key, day=body.day, channel_id=channel.id, user_id=user.id)
            .on_conflict_do_nothing()
            .returning(DailyShare.channel_id)
        )
        if claimed is None:
            already.append(channel.id)
            continue
        embed = {
            "addon_key": "daily",
            "id": f"{game.key}:{body.day.isoformat()}",
            "game": game.key,
            "day": body.day.isoformat(),
            "time_ms": result.time_ms,
            "attempts": result.attempts,
        }
        await post_message(session, channel, user.id, challenge_text(game, result), embed=embed)
        shared.append(channel.id)
    return ShareOut(shared=shared, already=already)


@router.get("/{game_key}/ranking", response_model=list[RankEntry])
async def channel_ranking(game_key: str, channel_id: uuid.UUID, day: date, user: CurrentUser, session: SessionDep) -> list[RankEntry]:
    """A challenge card's ranking: that day's results of everyone who sees the channel."""
    game = _game(game_key)
    channel, _ = await chat_channel(session, channel_id, user.id)
    people = await channel_audience(session, channel)
    rows = await session.scalars(
        select(DailyResult)
        .where(DailyResult.user_id.in_(people), DailyResult.game == game.key, DailyResult.day == day, DailyResult.completed.is_(True))
        .order_by(DailyResult.time_ms, DailyResult.attempts, DailyResult.created_at)
    )
    return [RankEntry(user_id=r.user_id, time_ms=r.time_ms, attempts=r.attempts) for r in rows]
