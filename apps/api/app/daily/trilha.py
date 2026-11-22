"""Trilha: a grid with some numbered cells and a few walls. Draw one path, cell to neighboring cell
(no diagonals, never through a wall), that starts at 1, meets the numbers in order, ends on the
highest and goes through every cell once.

A random path through the whole grid is drawn first, with its two ends and a few cells along the
way numbered. While the solver finds another path that also fits, a wall goes where that path
passes and ours doesn't (which rules it out for good), until the puzzle has a single solution.
When the search can't tell quickly, one more number narrows it down first.

The grid grows with the day's difficulty: 5x5, 6x6 or 7x7.
"""

import random
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from app.daily import DailyGame

SIZES = {"facil": 5, "medio": 6, "dificil": 7}
# Numbers to start with (the two ends included); more are added if the search can't decide.
START_NUMBERS = {5: 6, 6: 7, 7: 8}
# A search longer than this can't tell in time; the generator then adds a number and asks again.
# The bigger grid gets more room, or it ends up with too many numbers.
MAX_STEPS = {5: 40_000, 6: 40_000, 7: 250_000}


@dataclass(frozen=True)
class Grid:
    size: int
    neighbors: tuple[tuple[int, ...], ...]
    bits: tuple[int, ...]
    left: int
    right: int
    full: int

    @property
    def cells(self) -> int:
        return self.size * self.size

    def spread(self, m: int) -> int:
        s = self.size
        return ((m << s) | (m >> s) | ((m & ~self.right) << 1) | ((m & ~self.left) >> 1)) & self.full

    def open_bits(self, walls: list[list[int]]) -> list[int]:
        """Each cell's neighbors that no wall cuts off."""
        bits = list(self.bits)
        for a, b in walls:
            bits[a] &= ~(1 << b)
            bits[b] &= ~(1 << a)
        return bits


@lru_cache
def grid(size: int) -> Grid:
    def near(i: int) -> tuple[int, ...]:
        r, c = divmod(i, size)
        out = []
        if r > 0:
            out.append(i - size)
        if r < size - 1:
            out.append(i + size)
        if c > 0:
            out.append(i - 1)
        if c < size - 1:
            out.append(i + 1)
        return tuple(out)

    neighbors = tuple(near(i) for i in range(size * size))
    return Grid(
        size=size,
        neighbors=neighbors,
        bits=tuple(sum(1 << n for n in ns) for ns in neighbors),
        left=sum(1 << (r * size) for r in range(size)),
        right=sum(1 << (r * size + size - 1) for r in range(size)),
        full=(1 << size * size) - 1,
    )


def _random_path(g: Grid, rng: random.Random) -> list[int] | None:
    """A path through every cell (Warnsdorff's rule with random ties, restarted when stuck)."""
    for _ in range(200):
        start = rng.randrange(g.cells)
        path, seen = [start], {start}
        while len(path) < g.cells:
            options = [n for n in g.neighbors[path[-1]] if n not in seen]
            if not options:
                break
            rng.shuffle(options)
            options.sort(key=lambda n: sum(1 for m in g.neighbors[n] if m not in seen))
            path.append(options[0])
            seen.add(options[0])
        if len(path) == g.cells:
            return path
    return None


def _connected(g: Grid, free: int, current: int) -> bool:
    """Every free cell can still be reached from the path's end."""
    reach = g.bits[current] & free
    if not reach:
        return not free
    while True:
        grown = (reach | g.spread(reach)) & free
        if grown == reach:
            return reach == free
        reach = grown


def solutions(size: int, numbers: list[int], walls: list[list[int]] = [], limit: int = 2) -> list[list[int]] | None:  # noqa: B006
    """Up to `limit` paths that fit the numbers and walls; None if the search ran too long to tell."""
    g = grid(size)
    open_bits = g.open_bits(walls)
    cells_of = [i for _, i in sorted((n, i) for i, n in enumerate(numbers) if n)]
    last = len(cells_of)
    found: list[list[int]] = []
    path = [cells_of[0]]
    steps = 0

    def search(free: int, next_number: int) -> bool:
        nonlocal steps
        steps += 1
        if steps > MAX_STEPS[size]:
            return False
        current = path[-1]
        if not free:
            if next_number > last:
                found.append(list(path))
            return True
        if not _connected(g, free, current):
            return True
        options = open_bits[current] & free
        while options:
            bit = options & -options
            options ^= bit
            n = bit.bit_length() - 1
            number = numbers[n]
            if number and number != next_number:
                continue  # a number out of order
            rest = free ^ bit
            if number == last and rest:
                continue  # the highest number ends the path
            path.append(n)
            ok = search(rest, next_number + 1 if number else next_number)
            path.pop()
            if not ok:
                return False
            if len(found) >= limit:
                return True
        return True

    if not search(g.full ^ (1 << cells_of[0]), 2):
        return None
    return found


def generate(rng: random.Random, difficulty: str = "medio") -> tuple[dict[str, Any], list[int]]:
    size = SIZES[difficulty]
    g = grid(size)
    while True:
        path = _random_path(g, rng)
        if path is None:
            continue
        ours = {frozenset(step) for step in zip(path, path[1:])}
        marked = {0, g.cells - 1, *rng.sample(range(1, g.cells - 1), START_NUMBERS[size] - 2)}
        walls: list[list[int]] = []
        while len(marked) < g.cells:
            numbers = [0] * g.cells
            for rank, index in enumerate(sorted(marked), start=1):
                numbers[path[index]] = rank
            found = solutions(size, numbers, walls)
            if found is None:
                # Too many ways to tell quickly: one more number narrows it down.
                marked.add(rng.choice([k for k in range(g.cells) if k not in marked]))
                continue
            others = [p for p in found if p != path]
            if not others:
                return {"size": size, "difficulty": difficulty, "numbers": numbers, "walls": walls}, path
            # A wall where the other path passes and ours doesn't.
            theirs = [sorted(step) for step in zip(others[0], others[0][1:]) if frozenset(step) not in ours]
            walls.append(rng.choice(theirs))


def check(puzzle: dict[str, Any], solution: list[int], answer: Any) -> bool:
    """Any path that keeps the rules wins (there is only one, but the rules are what count)."""
    size: int = puzzle["size"]
    g = grid(size)
    numbers: list[int] = puzzle["numbers"]
    if not isinstance(answer, list) or len(answer) != g.cells:
        return False
    if not all(isinstance(i, int) and not isinstance(i, bool) and 0 <= i < g.cells for i in answer) or len(set(answer)) != g.cells:
        return False
    open_bits = g.open_bits(puzzle.get("walls", []))
    if any(not open_bits[a] >> b & 1 for a, b in zip(answer, answer[1:])):
        return False
    met = [numbers[i] for i in answer if numbers[i]]
    return met == list(range(1, max(numbers) + 1))


def hint(puzzle: dict[str, Any], solution: list[int], state: Any, rng: random.Random) -> dict[str, Any]:
    """The next step: how much of the path drawn so far is right (`keep` cells, at least the 1)
    and the cell it goes to from there."""
    path = state if isinstance(state, list) else []
    keep = 0
    while keep < len(path) and keep < len(solution) and path[keep] == solution[keep]:
        keep += 1
    keep = max(keep, 1)
    return {"keep": keep, "cell": solution[min(keep, len(solution) - 1)]}


GAME = DailyGame(key="trilha", name="Trilha", generate=generate, check=check, hint=hint)
