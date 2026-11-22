"""Daily games (block 4.2.10): the same puzzle for everyone, a single solution, one result per
person per game per day, the streak and friends who played today."""

from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app import daily
from app.daily import cacapalavras, sudoku, trilha
from app.daily.words import THEMES
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


def test_the_day_is_brasilias_and_turns_at_1am() -> None:
    # 01:30 UTC is 22:30 the day before in Brasília.
    assert daily.today(datetime(2026, 11, 23, 1, 30, tzinfo=UTC)) == date(2026, 11, 22)
    # Midnight and 00:59 in Brasília still play the day before; 1 a.m. brings the new one.
    assert daily.today(datetime(2026, 11, 23, 3, 0, tzinfo=UTC)) == date(2026, 11, 22)
    assert daily.today(datetime(2026, 11, 23, 3, 59, tzinfo=UTC)) == date(2026, 11, 22)
    assert daily.today(datetime(2026, 11, 23, 4, 0, tzinfo=UTC)) == date(2026, 11, 23)


@pytest.mark.parametrize("difficulty", daily.DIFFICULTIES)
@pytest.mark.parametrize("offset", range(4))
def test_every_sudoku_has_one_solution(offset: int, difficulty: str) -> None:
    day = date(2026, 11, 22) + timedelta(days=offset)
    puzzle, solution = sudoku.generate(daily.rng_for("sudoku", day), difficulty)
    assert sudoku.solutions(puzzle["givens"], limit=3) == [solution]
    # Fewer given numbers the harder it is (a symmetric pair can take one past the target, and a
    # few more may stay to keep it unique).
    target = sudoku.CLUES_BY[difficulty]
    assert target - 1 <= sum(1 for v in puzzle["givens"] if v) <= target + 4
    assert puzzle["difficulty"] == difficulty
    # Made from the day alone: the same again, and different the next day.
    assert sudoku.generate(daily.rng_for("sudoku", day), difficulty)[0] == puzzle
    assert sudoku.generate(daily.rng_for("sudoku", day + timedelta(days=1)), difficulty)[0] != puzzle


def test_the_difficulty_is_drawn_for_each_day() -> None:
    days = [date(2026, 11, 1) + timedelta(days=i) for i in range(90)]
    drawn = [daily.difficulty_for("sudoku", d) for d in days]
    assert set(drawn) == set(daily.DIFFICULTIES)
    # The same day is the same for everyone, and Mondays aren't all alike.
    assert drawn == [daily.difficulty_for("sudoku", d) for d in days]
    mondays = {daily.difficulty_for("sudoku", d) for d in days if d.weekday() == 0}
    assert len(mondays) > 1


async def test_everyone_gets_the_same_puzzle_without_the_answer(client: AsyncClient) -> None:
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    first = (await ana.get("/daily/sudoku")).json()
    second = (await bia.get("/daily/sudoku")).json()
    assert first["puzzle"] == second["puzzle"] and first["day"] == daily.today().isoformat()
    # The answer key only comes once the puzzle is finished.
    assert first["solution"] is None and first["result"] is None
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
    # The solution as played comes back for "Ver jogo".
    assert result["answer"] == solution
    # The time can't be more than since the puzzle was opened (a second ago).
    assert result["time_ms"] <= 5_000
    # Again: the same result, nothing new.
    assert (await check(ana, "sudoku", day, solution, time_ms=1))["result"] == result
    after = (await ana.get("/daily/sudoku")).json()
    assert after["result"] == result and after["solution"] == solution


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
    assert summary["games"] == ["sudoku", "trilha", "cacapalavras"] and summary["results"] == []
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
    # Ties go to fewer hints, then to who finished first (Bia's row went in before Caio's).
    expected = [
        {"user_id": bia.id, "time_ms": 60_000, "attempts": 3, "hints": 0},
        {"user_id": caio.id, "time_ms": 60_000, "attempts": 1, "hints": 0},
        {"user_id": ana.id, "time_ms": 90_000, "attempts": 1, "hints": 0},
    ]
    # The fastest first; someone who isn't a friend never shows.
    assert (await ana.get("/daily")).json()["rankings"] == {"sudoku": expected}
    assert (await ana.get("/daily/sudoku")).json()["ranking"] == expected
    # Bia only sees her own friends (Ana), not Caio.
    assert [r["user_id"] for r in (await bia.get("/daily/sudoku")).json()["ranking"]] == [bia.id, ana.id]
    # Fewer hints win a tie in time.
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE daily_results SET hints = 2 WHERE user_id = :u"), {"u": bia.id})
    assert [r["user_id"] for r in (await ana.get("/daily/sudoku")).json()["ranking"]][:2] == [caio.id, bia.id]


@pytest.mark.parametrize("difficulty", daily.DIFFICULTIES)
@pytest.mark.parametrize("offset", range(3))
def test_every_trilha_has_one_path(offset: int, difficulty: str) -> None:
    day = date(2026, 11, 22) + timedelta(days=offset)
    puzzle, path = trilha.generate(daily.rng_for("trilha", day), difficulty)
    assert puzzle["size"] == trilha.SIZES[difficulty] and len(path) == puzzle["size"] ** 2
    assert trilha.solutions(puzzle["size"], puzzle["numbers"], puzzle["walls"], limit=3) == [path]
    numbers = puzzle["numbers"]
    # Starts on 1, ends on the highest, and stays readable: few numbers.
    assert numbers[path[0]] == 1 and numbers[path[-1]] == max(numbers) <= 12
    assert trilha.generate(daily.rng_for("trilha", day), difficulty)[0] == puzzle


def test_trilha_checks_the_rules() -> None:
    puzzle, path = trilha.generate(daily.rng_for("trilha", date(2026, 11, 22)))
    assert trilha.check(puzzle, path, path)
    assert not trilha.check(puzzle, path, path[::-1])  # backwards: the numbers out of order
    assert not trilha.check(puzzle, path, path[:-1])  # a cell left out
    jump = list(path)
    jump[1], jump[2] = jump[2], jump[1]
    assert not trilha.check(puzzle, path, jump)  # not neighbors, or numbers out of order
    if puzzle["walls"]:
        a, b = puzzle["walls"][0]
        assert not trilha.grid(puzzle["size"]).open_bits(puzzle["walls"])[a] >> b & 1
    assert not trilha.check(puzzle, path, "nope")


async def test_trilha_is_played_like_the_others(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    got = (await ana.get("/daily/trilha")).json()
    assert set(got["puzzle"]) == {"size", "difficulty", "numbers", "walls"}
    day = got["day"]
    path = await solution_of("trilha", day)
    assert (await check(ana, "trilha", day, path))["result"]["attempts"] == 1


@pytest.mark.parametrize("difficulty", daily.DIFFICULTIES)
@pytest.mark.parametrize("offset", range(4))
def test_every_word_has_a_single_place(offset: int, difficulty: str) -> None:
    day = date(2026, 11, 22) + timedelta(days=offset)
    puzzle, solution = cacapalavras.generate(daily.rng_for("cacapalavras", day), difficulty)
    size, count = cacapalavras.LEVELS[difficulty]
    grid = list("".join(puzzle["rows"]))
    assert puzzle["size"] == size and len(grid) == size * size and all("A" <= ch <= "Z" for ch in grid)
    # Half of them diagonal, and never all one way.
    diagonal = [a for a, b in solution if a // size != b // size and a % size != b % size]
    assert len(diagonal) == count // 2
    assert len(puzzle["words"]) == count and puzzle["words"] == sorted(puzzle["words"])
    for word in puzzle["words"]:
        assert word in THEMES[puzzle["theme"]]
        assert len(cacapalavras.occurrences(grid, cacapalavras.plain(word))) == 1
    assert not any(cacapalavras.occurrences(grid, b) for b in cacapalavras.BLOCKED)
    assert cacapalavras.check(puzzle, solution, solution)
    assert cacapalavras.generate(daily.rng_for("cacapalavras", day), difficulty)[0] == puzzle


def test_word_search_checks_each_word() -> None:
    puzzle, solution = cacapalavras.generate(daily.rng_for("cacapalavras", date(2026, 11, 22)))
    assert cacapalavras.check(puzzle, solution, [[b, a] for a, b in solution])  # dragged backwards
    assert not cacapalavras.check(puzzle, solution, solution[::-1])  # words swapped
    assert not cacapalavras.check(puzzle, solution, solution[:-1])
    assert not cacapalavras.check(puzzle, solution, [[0, 0]] * len(solution))
    assert cacapalavras.plain("Maçã") == "MACA" and cacapalavras.plain("pêssego") == "PESSEGO"


def test_the_word_list_is_tidy() -> None:
    for theme, words in THEMES.items():
        assert len(words) >= 20, theme
        assert all(w == w.strip() and " " not in w and "-" not in w for w in words), theme
        # Enough short words for the easy grid too.
        size, count = cacapalavras.LEVELS["facil"]
        assert sum(1 for w in words if 4 <= len(cacapalavras.plain(w)) <= size) >= count, theme


async def solve(user: ApiUser, game: str = "sudoku") -> str:
    day = (await user.get(f"/daily/{game}")).json()["day"]
    await check(user, game, day, await solution_of(game, day))
    return day


async def test_sharing_posts_a_challenge_without_the_answer(client: AsyncClient) -> None:
    from tests.test_dms import open_dm

    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await befriend(ana, bia)
    dm = await open_dm(ana, bia)
    day = (await ana.get("/daily/sudoku")).json()["day"]
    # Only after finishing.
    assert (await ana.post("/daily/sudoku/share", {"day": day, "channel_ids": [dm["id"]]})).status_code == 409
    await check(ana, "sudoku", day, await solution_of("sudoku", day))

    res = await ana.post("/daily/sudoku/share", {"day": day, "channel_ids": [dm["id"]]})
    assert res.status_code == 200 and res.json() == {"shared": [dm["id"]], "already": []}
    [message] = (await bia.get(f"/channels/{dm['id']}/messages")).json()
    assert message["embed"]["addon_key"] == "daily" and message["embed"]["game"] == "sudoku" and message["embed"]["day"] == day
    assert "Desafio do dia: Sudoku" in message["content"] and "Consegue fazer melhor?" in message["content"]
    # No spoiler: nothing of the grid.
    solution = "".join(map(str, await solution_of("sudoku", day)))
    assert solution[:9] not in message["content"] and "solution" not in message["embed"]
    # One challenge per game, day and channel.
    again = await ana.post("/daily/sudoku/share", {"day": day, "channel_ids": [dm["id"]]})
    assert again.json() == {"shared": [], "already": [dm["id"]]}
    assert len((await bia.get(f"/channels/{dm['id']}/messages")).json()) == 1


async def test_sharing_needs_to_be_able_to_write_there(client: AsyncClient) -> None:
    from app.permissions import Perm
    from tests.helpers import make_server, text_channel
    from tests.test_private_channels import create_private

    owner, ana = await make_user(client, "owner"), await make_user(client, "ana")
    server = await make_server(owner, ana)
    sid, chat = server["id"], text_channel(server)
    private = await create_private(owner, sid)
    day = await solve(ana)
    assert (await ana.post("/daily/sudoku/share", {"day": day, "channel_ids": [private["id"]]})).status_code == 404
    res = await owner.put(f"/channels/{chat}/overrides/role/{sid}", {"allow": 0, "deny": int(Perm.SEND_MESSAGES)})
    assert res.status_code == 200
    assert (await ana.post("/daily/sudoku/share", {"day": day, "channel_ids": [chat]})).status_code == 403
    # Nothing was posted anywhere.
    assert (await owner.get(f"/channels/{chat}/messages")).json() == []


async def test_a_challenge_ranks_everyone_who_sees_the_channel(client: AsyncClient) -> None:
    from tests.helpers import make_server, text_channel

    owner, ana, bia, zed = [await make_user(client, n) for n in ("owner", "ana", "bia", "zed")]
    server = await make_server(owner, ana, bia)
    chat = text_channel(server)
    day = await solve(ana)
    await solve(bia)
    await solve(zed)  # not in the server
    res = await ana.post("/daily/sudoku/share", {"day": day, "channel_ids": [chat]})
    assert res.json()["shared"] == [chat]
    ranking = (await owner.get("/daily/sudoku/ranking", params={"channel_id": chat, "day": day})).json()
    assert {r["user_id"] for r in ranking} == {ana.id, bia.id}
    assert (await zed.get("/daily/sudoku/ranking", params={"channel_id": chat, "day": day})).status_code == 404


# --- Streaks and their badges (block 4.2.13) ---------------------------------------------------

from app.daily import streak_badges  # noqa: E402
from app.daily.streaks import Streak, level_of, streak_of as game_streak  # noqa: E402


def test_freezes_carry_a_streak_over_missed_days() -> None:
    today = date(2026, 11, 30)
    back = lambda n: today - timedelta(days=n)  # noqa: E731
    assert game_streak([back(i) for i in range(1, 8)], today) == Streak(7, 1)  # today not played yet
    assert game_streak([back(i) for i in range(2, 9)], today) == Streak(7, 0)  # yesterday frozen
    assert game_streak([back(i) for i in range(3, 10)], today) == Streak(0, 0)  # two missed, one freeze
    assert game_streak([back(i) for i in range(0, 15)] + [back(i) for i in range(17, 40)], today) == Streak(38, 2)
    assert game_streak([back(i) for i in range(0, 30)], today).freezes == 2  # never more than 2
    assert [level_of(n) for n in (2, 3, 6, 7, 29, 30, 365, 900)] == [None, 3, 3, 7, 7, 30, 365, 365]


async def played(user: ApiUser, game: str, *days_back: int) -> None:
    today = daily.today()
    async with engine.begin() as conn:
        for n in days_back:
            await conn.execute(
                text("INSERT INTO daily_results (user_id, game, day, time_ms, attempts) VALUES (:u, :g, :d, 1000, 1) ON CONFLICT DO NOTHING"),
                {"u": user.id, "g": game, "d": today - timedelta(days=n)},
            )


async def daily_badges(user: ApiUser) -> list[str]:
    me = (await user.get("/users/me")).json()
    return sorted(b["key"] for b in me["badges"] if b["key"].startswith("daily_"))


async def test_a_streak_earns_its_badge_and_levels_up(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    await played(ana, "sudoku", 1, 2)
    await solve(ana)  # today: 3 days in a row
    assert await daily_badges(ana) == ["daily_sudoku_3"]
    summary = (await ana.get("/daily")).json()
    assert summary["streaks"]["sudoku"] == {"days": 3, "freezes": 0}
    assert summary["streaks"]["trilha"] == {"days": 0, "freezes": 0}

    # Featured on the profile, then 7 days: the new level takes its place.
    assert (await ana.put("/users/me/badges/featured", {"keys": ["daily_sudoku_3"]})).status_code in (200, 204)
    await played(ana, "sudoku", 3, 4, 5, 6)
    from app.db import SessionLocal

    async with SessionLocal() as session:
        await streak_badges.sync(session, uuid_of(ana))
    me = (await ana.get("/users/me")).json()
    held = [b for b in me["badges"] if b["key"].startswith("daily_")]
    assert [b["key"] for b in held] == ["daily_sudoku_7"]
    assert held[0].get("featured_position") == 0


async def test_a_broken_streak_takes_the_badge_away(client: AsyncClient) -> None:
    from app.db import SessionLocal

    ana = await make_user(client, "ana")
    await played(ana, "trilha", 1, 2, 3)
    async with SessionLocal() as session:
        await streak_badges.sync(session, uuid_of(ana))
    assert await daily_badges(ana) == ["daily_trilha_3"]
    # The same days, a week later: two missed days and no freeze.
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE daily_results SET day = day - 7 WHERE user_id = :u"), {"u": ana.id})
    async with SessionLocal() as session:
        await streak_badges.sync(session, uuid_of(ana))
    assert await daily_badges(ana) == []


def uuid_of(user: ApiUser):  # noqa: ANN201
    import uuid

    return uuid.UUID(user.id)


def test_streak_badges_top_out_at_legendary() -> None:
    from app.badges import BADGES
    from app.models import BadgeRarity

    daily_badges = [b for k, b in BADGES.items() if k.startswith("daily_")]
    assert len(daily_badges) == 18
    assert all(b.rarity != BadgeRarity.mitica for b in daily_badges)
    assert BADGES["daily_sudoku_365"].rarity == BadgeRarity.lendaria
    # No mythic outer ring in their art.
    assert 'points="48,4' not in BADGES["daily_sudoku_365"].icon_svg



# --- Hints -------------------------------------------------------------------------------------


def test_hints_nudge_without_solving() -> None:
    import random

    rng = random.Random(1)
    puzzle, solution = sudoku.generate(daily.rng_for("sudoku", date(2026, 11, 22)))
    cells = list(puzzle["givens"])
    first_empty = cells.index(0)
    cells[first_empty] = solution[first_empty] % 9 + 1  # a wrong number
    assert sudoku.hint(puzzle, solution, cells, rng) == {"cell": first_empty, "value": solution[first_empty]}  # fixes it first
    got = sudoku.hint(puzzle, solution, list(puzzle["givens"]), rng)
    assert puzzle["givens"][got["cell"]] == 0 and got["value"] == solution[got["cell"]]

    puzzle, path = trilha.generate(daily.rng_for("trilha", date(2026, 11, 22)))
    assert trilha.hint(puzzle, path, path[:4], rng) == {"keep": 4, "cell": path[4]}
    wrong = path[:3] + [path[-1]]
    assert trilha.hint(puzzle, path, wrong, rng) == {"keep": 3, "cell": path[3]}  # back to where it was right
    assert trilha.hint(puzzle, path, [], rng) == {"keep": 1, "cell": path[1]}

    puzzle, pairs = cacapalavras.generate(daily.rng_for("cacapalavras", date(2026, 11, 22)))
    got = cacapalavras.hint(puzzle, pairs, list(range(len(pairs) - 1)), rng)
    assert got == {"word": len(pairs) - 1, "cell": pairs[-1][0]}  # the one not found yet


async def test_a_hint_every_30_seconds_counted_in_the_result(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    day = (await ana.get("/daily/trilha")).json()["day"]
    first = await ana.post("/daily/trilha/hint", {"day": day, "state": []})
    assert first.status_code == 200, first.text
    assert first.json()["used"] == 1 and set(first.json()["hint"]) == {"keep", "cell"}
    again = await ana.post("/daily/trilha/hint", {"day": day, "state": []})
    assert again.status_code == 429 and int(again.headers["retry-after"]) <= 30
    # The wait passes.
    from app.config import get_settings
    from app.realtime import broker

    await broker.redis.delete(f"{get_settings().redis_prefix}:daily:hint-wait:{ana.id}:trilha:{day}")
    assert (await ana.post("/daily/trilha/hint", {"day": day, "state": []})).json()["used"] == 2
    done = await check(ana, "trilha", day, await solution_of("trilha", day))
    assert done["result"]["hints"] == 2
    ranking = (await ana.get("/daily/trilha")).json()["ranking"]
    assert ranking[0]["hints"] == 2
    # Solved: no more hints.
    assert (await ana.post("/daily/trilha/hint", {"day": day, "state": []})).status_code == 409


async def test_the_summary_says_each_games_difficulty(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    summary = (await ana.get("/daily")).json()
    today = daily.today()
    assert summary["difficulties"] == {key: daily.difficulty_for(key, today) for key in daily.GAMES}



# --- A game in progress ------------------------------------------------------------------------


async def test_closing_a_game_keeps_the_board_and_the_time(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    got = (await ana.get("/daily/sudoku")).json()
    day = got["day"]
    assert got["progress"] is None
    board = list(got["puzzle"]["givens"])
    board[board.index(0)] = 7
    res = await ana.put("/daily/sudoku/progress", {"day": day, "state": {"cells": board, "hinted": []}, "elapsed_ms": 8_000})
    assert res.status_code == 204, res.text
    again = (await ana.get("/daily/sudoku")).json()
    assert again["progress"] == {"state": {"cells": board, "hinted": []}, "elapsed_ms": 8_000}
    # Someone else starts from scratch.
    bia = await make_user(client, "bia")
    assert (await bia.get("/daily/sudoku")).json()["progress"] is None
    # Solved: it's gone, and nothing more is kept.
    await check(ana, "sudoku", day, await solution_of("sudoku", day))
    assert (await ana.get("/daily/sudoku")).json()["progress"] is None
    assert (await ana.put("/daily/sudoku/progress", {"day": day, "state": None, "elapsed_ms": 1})).status_code == 409


async def test_progress_has_limits(client: AsyncClient) -> None:
    ana = await make_user(client, "ana")
    day = (await ana.get("/daily/trilha")).json()["day"]
    assert (await ana.put("/daily/trilha/progress", {"day": day, "state": "x" * 9_000, "elapsed_ms": 1})).status_code == 413
    old = (daily.today() - timedelta(days=2)).isoformat()
    assert (await ana.put("/daily/trilha/progress", {"day": old, "state": [], "elapsed_ms": 1})).status_code == 409
