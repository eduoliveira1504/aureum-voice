"""Daily games (block 4.2.10): the same puzzle for everyone, a single solution, one result per
person per game per day, the streak and friends who played today."""

from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app import daily
from app.daily import sudoku
from app.db import engine
from app.routers.daily import streak_of
from tests.helpers import ApiUser, make_user
from tests.test_friends import befriend


async def solution_of(game: str, day: str) -> Any:
    async with engine.connect() as conn:
        return (await conn.execute(text("SELECT solution FROM daily_puzzles WHERE game = :g AND day = :d"), {"g": game, "d": date.fromisoformat(day)})).scalar_one()


async def check(user: ApiUser, game: str, day: str, answer: Any, time_ms: int = 60_000) -> dict[str, Any]:
    res = await user.post(f"/daily/{game}/check", {"day": day, "answer": answer, "time_ms": time_ms})
    assert res.status_code == 200, res.text
    return res.json()


def test_the_day_is_brasilias() -> None:
    # 01:30 UTC is still the day before in Brasília.
    assert daily.today(datetime(2026, 11, 23, 1, 30, tzinfo=UTC)) == date(2026, 11, 22)
    assert daily.today(datetime(2026, 11, 23, 3, 0, tzinfo=UTC)) == date(2026, 11, 23)


@pytest.mark.parametrize("offset", range(7))
def test_every_sudoku_has_one_solution(offset: int) -> None:
    day = date(2026, 11, 22) + timedelta(days=offset)
    puzzle, solution = sudoku.generate(daily.rng_for("sudoku", day))
    assert sudoku.solutions(puzzle["givens"], limit=3) == [solution]
    assert sum(1 for v in puzzle["givens"] if v) == sudoku.CLUES
    # Made from the day alone: the same again, and different the next day.
    assert sudoku.generate(daily.rng_for("sudoku", day))[0] == puzzle
    assert sudoku.generate(daily.rng_for("sudoku", day + timedelta(days=1)))[0] != puzzle


async def test_everyone_gets_the_same_puzzle_without_the_answer(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    first = (await ana.get("/daily/sudoku")).json()
    second = (await bia.get("/daily/sudoku")).json()
    assert first["puzzle"] == second["puzzle"] and first["day"] == daily.today().isoformat()
    assert "solution" not in first and first["result"] is None
    assert 0 in first["puzzle"]["givens"]
    assert (await ana.get("/daily/xadrez")).status_code == 404


async def test_one_result_per_day_counting_the_wrong_tries(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    day = (await ana.get("/daily/sudoku")).json()["day"]
    solution = await solution_of("sudoku", day)
    wrong = list(solution)
    wrong[0], wrong[1] = wrong[1], wrong[0]
    assert await check(ana, "sudoku", day, wrong) == {"correct": False, "result": None}
    assert (await check(ana, "sudoku", day, "nonsense"))["correct"] is False
    done = await check(ana, "sudoku", day, solution, time_ms=90_000)
    assert done["correct"] is True
    result = done["result"]
    assert result["attempts"] == 3 and result["completed"] is True
    # The time can't be more than since the puzzle was opened (a second ago).
    assert result["time_ms"] <= 5_000
    # Again: the same result, nothing new.
    assert (await check(ana, "sudoku", day, solution, time_ms=1))["result"] == result
    assert (await ana.get("/daily/sudoku")).json()["result"] == result


async def test_only_today_and_yesterday_are_open(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    old = (daily.today() - timedelta(days=2)).isoformat()
    res = await ana.post("/daily/sudoku/check", {"day": old, "answer": [], "time_ms": 1})
    assert res.status_code == 409


async def test_summary_with_streak_and_friends(client: AsyncClient) -> None:
    ana, bia, zed = [await make_user(client, n) for n in ("ana", "bia", "zed")]
    await befriend(ana, bia)
    for user in (bia, zed):
        day = (await user.get("/daily/sudoku")).json()["day"]
        await check(user, "sudoku", day, await solution_of("sudoku", day))
    today = daily.today()
    async with engine.begin() as conn:
        for back in (1, 2, 4):
            await conn.execute(
                text("INSERT INTO daily_results (user_id, game, day, time_ms, attempts) VALUES (:u, 'sudoku', :d, 1000, 1)"),
                {"u": ana.id, "d": today - timedelta(days=back)},
            )
    summary = (await ana.get("/daily")).json()
    assert summary["games"] == ["sudoku"] and summary["results"] == []
    # Yesterday and the day before; today not played yet still counts the run.
    assert summary["streak"] == 2
    # Only friends show, and only today's games.
    assert summary["friends_today"] == [{"user_id": bia.id, "games": ["sudoku"]}]


def test_streak_rules() -> None:
    today = date(2026, 11, 22)
    assert streak_of([], today) == 0
    assert streak_of([today], today) == 1
    assert streak_of([today - timedelta(days=1), today - timedelta(days=2)], today) == 2
    assert streak_of([today, today - timedelta(days=2)], today) == 1
    assert streak_of([today - timedelta(days=2)], today) == 0


async def test_friends_see_each_others_times_in_a_ranking(client: AsyncClient) -> None:
    ana, bia, caio, zed = [await make_user(client, n) for n in ("ana", "bia", "caio", "zed")]
    await befriend(ana, bia)
    await befriend(ana, caio)
    day = daily.today()
    async with engine.begin() as conn:
        for user, time_ms, attempts in ((ana, 90_000, 1), (bia, 60_000, 3), (caio, 60_000, 1), (zed, 1_000, 1)):
            await conn.execute(
                text("INSERT INTO daily_results (user_id, game, day, time_ms, attempts) VALUES (:u, 'sudoku', :d, :t, :a)"),
                {"u": user.id, "d": day, "t": time_ms, "a": attempts},
            )
    expected = [
        {"user_id": caio.id, "time_ms": 60_000, "attempts": 1},
        {"user_id": bia.id, "time_ms": 60_000, "attempts": 3},
        {"user_id": ana.id, "time_ms": 90_000, "attempts": 1},
    ]
    # The fastest first, fewer tries breaking a tie; someone who isn't a friend never shows.
    assert (await ana.get("/daily")).json()["rankings"] == {"sudoku": expected}
    assert (await ana.get("/daily/sudoku")).json()["ranking"] == expected
    # Bia only sees her own friends (Ana), not Caio.
    assert [r["user_id"] for r in (await bia.get("/daily/sudoku")).json()["ranking"]] == [bia.id, ana.id]
