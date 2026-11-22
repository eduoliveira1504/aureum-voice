"""Daily games on Home (block 4.2.10): today's puzzle, checking an answer, and the summary for
Home's card (results, streak, friends who played today). See app/daily."""

import asyncio
import json
import time
import uuid
from datetime import date, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import daily, ratelimit, social
from app.daily import streak_badges
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
# A saved game in progress, at most this big (a Sudoku grid, a path, the words found).
PROGRESS_BYTES = 8_000
# A new hint at most this often (Eduardo, 22/11).
HINT_SECONDS = 30
# Sharing: a few channels at once, and not many times an hour.
SHARE_CHANNELS = 10
SHARES = (30, 60 * 60)


class ResultOut(BaseModel):
    game: str
    day: date
    time_ms: int
    attempts: int
    completed: bool
    # The person's own solution ("Ver jogo"); never in a ranking.
    answer: Any = None
    hints: int = 0


class RankEntry(BaseModel):
    user_id: uuid.UUID
    time_ms: int
    attempts: int
    hints: int = 0


class ProgressIn(BaseModel):
    day: date
    # The board as the app keeps it (each game's own shape).
    state: Any = None
    # Time played so far: the clock stops while the game is closed (Eduardo, 22/11).
    elapsed_ms: Annotated[int, Field(ge=0, le=TRACK_SECONDS * 1000)]


class ProgressOut(BaseModel):
    state: Any = None
    elapsed_ms: int = 0


class PuzzleOut(BaseModel):
    game: str
    day: date
    puzzle: dict[str, Any]
    result: ResultOut | None = None
    # Today's results of the user and their friends in this game, best first.
    ranking: list[RankEntry] = []
    # The answer key, only once the user finished this day's puzzle (the board shown after it).
    solution: Any = None
    # Where the user left it (the board and the time played), to pick up from there.
    progress: ProgressOut | None = None


class FriendPlayed(BaseModel):
    user_id: uuid.UUID
    games: list[str]


class StreakOut(BaseModel):
    days: int
    freezes: int


class DailySummary(BaseModel):
    day: date
    games: list[str]
    results: list[ResultOut]
    # Days in a row with at least one game finished, up to today (or yesterday, if not yet today).
    streak: int
    friends_today: list[FriendPlayed]
    # Per game: today's results of the user and their friends, best first (a challenge among friends).
    rankings: dict[str, list[RankEntry]] = {}
    # Per game: the streak with its freezes (block 4.2.13; app/daily/streaks.py).
    streaks: dict[str, StreakOut] = {}
    # Per game: today's difficulty ("facil", "medio" or "dificil"), drawn for the day.
    difficulties: dict[str, str] = {}


class Check(BaseModel):
    day: date
    answer: Any
    # What the app's clock says; never more than the time since the puzzle was opened.
    time_ms: Annotated[int, Field(ge=0, le=TRACK_SECONDS * 1000)]


class CheckOut(BaseModel):
    correct: bool
    result: ResultOut | None = None


class HintAsk(BaseModel):
    day: date
    # Where the player is: the Sudoku grid, the Trilha path drawn, the indexes of the words found.
    state: Any = None


class HintOut(BaseModel):
    hint: dict[str, Any]
    # Hints used in this game today, this one included.
    used: int
    # When the next one can be asked for.
    next_in: int = HINT_SECONDS


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
    # Pure CPU (a hard Trilha can take seconds): off the event loop, so the API keeps answering.
    puzzle, solution = await asyncio.to_thread(game.generate, daily.rng_for(game.key, day), daily.difficulty_for(game.key, day))
    await session.execute(
        insert(DailyPuzzle).values(game=game.key, day=day, puzzle=puzzle, solution=solution).on_conflict_do_nothing()
    )
    await session.commit()
    saved = await session.get(DailyPuzzle, (game.key, day))
    assert saved is not None
    return saved


def _out(result: DailyResult) -> ResultOut:
    return ResultOut(
        game=result.game,
        day=result.day,
        time_ms=result.time_ms,
        attempts=result.attempts,
        completed=result.completed,
        answer=result.answer,
        hints=result.hints,
    )


async def rankings(session: AsyncSession, user_id: uuid.UUID, day: date, game: str | None = None) -> dict[str, list[RankEntry]]:
    """Per game, the day's finished results of the user and their friends: the shortest time
    first; on the very same time, whoever finished first. Only the time counts (Eduardo, 22/11):
    hints are shown, never weighed."""
    people = await social.friend_ids(session, user_id) | {user_id}
    query = select(DailyResult).where(DailyResult.user_id.in_(people), DailyResult.day == day, DailyResult.completed.is_(True))
    if game is not None:
        query = query.where(DailyResult.game == game)
    rows = await session.scalars(query.order_by(DailyResult.time_ms, DailyResult.created_at))
    out: dict[str, list[RankEntry]] = {}
    for r in rows:
        out.setdefault(r.game, []).append(RankEntry(user_id=r.user_id, time_ms=r.time_ms, attempts=r.attempts, hints=r.hints))
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
        streaks={k: StreakOut(days=s.days, freezes=s.freezes) for k, s in (await streak_badges.streaks_of(session, user.id)).items()},
        difficulties={key: (await puzzle_of(session, game, today)).puzzle.get("difficulty", "medio") for key, game in daily.GAMES.items()},
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
    solution = saved.solution if result is not None and result.completed else None
    progress = None if result is not None else await _progress(user.id, game.key, day)
    return PuzzleOut(
        game=game.key, day=day, puzzle=saved.puzzle, result=_out(result) if result else None, ranking=ranking, solution=solution, progress=progress
    )


async def _progress(user_id: uuid.UUID, game: str, day: date) -> ProgressOut | None:
    try:
        raw = await broker.redis.get(_track_key("progress", user_id, game, day))
    except Exception:  # noqa: BLE001 - without Redis the game just starts over
        return None
    return ProgressOut.model_validate(json.loads(raw)) if raw else None


@router.put("/{game_key}/progress", status_code=status.HTTP_204_NO_CONTENT)
async def save_progress(game_key: str, body: ProgressIn, user: CurrentUser, session: SessionDep) -> Response:
    """Keeps where the user left an unfinished game, so closing it doesn't lose the board or the
    time played. Gone once it's solved, or after a couple of days."""
    game = _game(game_key)
    today = daily.today()
    if body.day not in (today, today - timedelta(days=1)):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="That puzzle is no longer open")
    if await session.get(DailyResult, (user.id, game.key, body.day)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Already solved")
    data = json.dumps({"state": body.state, "elapsed_ms": body.elapsed_ms})
    if len(data) > PROGRESS_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Too much to keep")
    await broker.redis.set(_track_key("progress", user.id, game.key, body.day), data, ex=TRACK_SECONDS)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
    wrong = hints = 0
    try:
        started = await broker.redis.get(_track_key("start", user.id, game.key, body.day))
        if started is not None:
            time_ms = min(time_ms, int((time.time() - float(started)) * 1000) + 1000)
        wrong = int(await broker.redis.get(wrong_key) or 0)
        hints = int(await broker.redis.get(_track_key("hints", user.id, game.key, body.day)) or 0)
    except Exception:  # noqa: BLE001
        pass
    await session.execute(
        insert(DailyResult)
        .values(
            user_id=user.id,
            game=game.key,
            day=body.day,
            time_ms=max(time_ms, 0),
            attempts=wrong + 1,
            completed=True,
            answer=body.answer,
            hints=hints,
        )
        .on_conflict_do_nothing()
    )
    await session.commit()
    result = await session.get(DailyResult, (user.id, game.key, body.day))
    assert result is not None
    out = CheckOut(correct=True, result=_out(result))
    try:
        await broker.redis.delete(_track_key("progress", user.id, game.key, body.day))
    except Exception:  # noqa: BLE001
        pass
    await streak_badges.sync_and_announce(user.id)
    return out


def challenge_text(game: daily.DailyGame, result: DailyResult) -> str:
    """What apps that don't know the games show: the result, never the answer."""
    seconds = result.time_ms // 1000
    return (
        f"Desafio do dia: {game.name} de {result.day.strftime('%d/%m')}. Fiz em {seconds // 60}:{seconds % 60:02d}. "
        "Consegue fazer melhor? Jogue em Jogos do dia, no Início do Aureum."
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
        .order_by(DailyResult.time_ms, DailyResult.created_at)
    )
    return [RankEntry(user_id=r.user_id, time_ms=r.time_ms, attempts=r.attempts, hints=r.hints) for r in rows]


@router.post("/{game_key}/hint", response_model=HintOut)
async def ask_hint(game_key: str, body: HintAsk, user: CurrentUser, session: SessionDep) -> HintOut:
    """A nudge that doesn't solve it (where a word begins, the Trilha's next step, a Sudoku number),
    one every HINT_SECONDS. They're counted and shown with the result."""
    game = _game(game_key)
    today = daily.today()
    if body.day not in (today, today - timedelta(days=1)):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="That puzzle is no longer open")
    if await session.get(DailyResult, (user.id, game.key, body.day)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Already solved")
    saved = await session.get(DailyPuzzle, (game.key, body.day))
    if saved is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Open the puzzle first")
    wait_key = _track_key("hint-wait", user.id, game.key, body.day)
    if not await broker.redis.set(wait_key, 1, nx=True, ex=HINT_SECONDS):
        left = await broker.redis.ttl(wait_key)
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, detail="Wait for the next hint", headers={"Retry-After": str(max(left, 1))}
        )
    count_key = _track_key("hints", user.id, game.key, body.day)
    used = int(await broker.redis.incr(count_key))
    await broker.redis.expire(count_key, TRACK_SECONDS)
    nudge = game.hint(saved.puzzle, saved.solution, body.state, daily.rng_for(game.key, body.day, f":hint:{user.id}:{used}"))
    return HintOut(hint=nudge, used=used)
