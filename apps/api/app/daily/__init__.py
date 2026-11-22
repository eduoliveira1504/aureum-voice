"""Daily games on Home (block 4.2.10; see docs/decisions/0053-daily-games.md).

One puzzle per game per day, the same for everyone: made by an algorithm from the day (Brasília),
with a solver that guarantees a single solution. No AI. The first request of the day saves it in
`daily_puzzles`, so restarts or another Python version never change it mid-day. The app gets the
puzzle, never the solution: the API checks answers.
"""

import hashlib
import random
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any

# Brazil has had no daylight saving time since 2019, and the slim image has no tz database.
BRASILIA = timezone(timedelta(hours=-3))
# A new day's puzzles come out at 1 a.m. in Brasília (Eduardo, 22/11), not at midnight.
NEW_DAY_AT = timedelta(hours=1)


def today(now: datetime | None = None) -> date:
    """The games' day: Brasília's, turning at 1 a.m."""
    return ((now or datetime.now(UTC)).astimezone(BRASILIA) - NEW_DAY_AT).date()


def rng_for(game: str, day: date) -> random.Random:
    """The day's random source for a game: the same everywhere, different every day."""
    digest = hashlib.sha256(f"aureum-daily:{game}:{day.isoformat()}".encode()).digest()
    return random.Random(int.from_bytes(digest[:16], "big"))


@dataclass(frozen=True)
class DailyGame:
    key: str
    # As it reads in a shared challenge's plain text (apps that don't know the games).
    name: str
    # (rng) -> (what the app gets, the solution kept in the API)
    generate: Callable[[random.Random], tuple[dict[str, Any], Any]]
    # (puzzle, solution, the player's answer) -> solved?
    check: Callable[[dict[str, Any], Any, Any], bool]


def _games() -> dict[str, DailyGame]:
    from app.daily import cacapalavras, sudoku, trilha

    return {g.key: g for g in (sudoku.GAME, trilha.GAME, cacapalavras.GAME)}


GAMES: dict[str, DailyGame] = _games()
