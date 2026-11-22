"""Trilha: a grid with some numbered cells and a few walls. Draw one path, cell to neighboring cell
(no diagonals, never through a wall), that starts at 1, meets the numbers in order, ends on the
highest and goes through every cell once.

A random path through the whole grid is drawn first, with its two ends and a few cells along the
way numbered. While the solver finds another path that also fits, a wall goes where that path
passes and ours doesn't (which rules it out for good), until the puzzle has a single solution.
When the search can't tell quickly, one more number narrows it down first.
"""

import random
from typing import Any

from app.daily import DailyGame

SIZE = 6
CELLS = SIZE * SIZE
# Numbers to start with (the two ends included); more are added until the solution is unique.
START_NUMBERS = 7
# A search longer than this can't tell in time; the generator then adds a number and asks again.
MAX_STEPS = 40_000


def _neighbors(i: int) -> list[int]:
    r, c = divmod(i, SIZE)
    out = []
    if r > 0:
        out.append(i - SIZE)
    if r < SIZE - 1:
        out.append(i + SIZE)
    if c > 0:
        out.append(i - 1)
    if c < SIZE - 1:
        out.append(i + 1)
    return out


NEIGHBORS = [_neighbors(i) for i in range(CELLS)]


def _random_path(rng: random.Random) -> list[int] | None:
    """A path through every cell (Warnsdorff's rule with random ties, restarted when stuck)."""
    for _ in range(200):
        start = rng.randrange(CELLS)
        path, seen = [start], {start}
        while len(path) < CELLS:
            options = [n for n in NEIGHBORS[path[-1]] if n not in seen]
            if not options:
                break
            rng.shuffle(options)
            options.sort(key=lambda n: sum(1 for m in NEIGHBORS[n] if m not in seen))
            nxt = options[0]
            path.append(nxt)
            seen.add(nxt)
        if len(path) == CELLS:
            return path
    return None


# Cells as bits of an int: flooding a region is a few shifts instead of a loop over cells.
NEIGHBOR_BITS = [sum(1 << n for n in NEIGHBORS[i]) for i in range(CELLS)]
_LEFT = sum(1 << (r * SIZE) for r in range(SIZE))
_RIGHT = sum(1 << (r * SIZE + SIZE - 1) for r in range(SIZE))
_ALL = (1 << CELLS) - 1


def _spread(m: int) -> int:
    return ((m << SIZE) | (m >> SIZE) | ((m & ~_RIGHT) << 1) | ((m & ~_LEFT) >> 1)) & _ALL


def _connected(free: int, current: int) -> bool:
    """Every free cell can still be reached from the path's end."""
    reach = NEIGHBOR_BITS[current] & free
    if not reach:
        return not free
    while True:
        grown = (reach | _spread(reach)) & free
        if grown == reach:
            return reach == free
        reach = grown


def _open_bits(walls: list[list[int]]) -> list[int]:
    """Each cell's neighbors that no wall cuts off."""
    bits = list(NEIGHBOR_BITS)
    for a, b in walls:
        bits[a] &= ~(1 << b)
        bits[b] &= ~(1 << a)
    return bits


def solutions(numbers: list[int], walls: list[list[int]] = [], limit: int = 2) -> list[list[int]] | None:  # noqa: B006
    """Up to `limit` paths that fit the numbers and walls; None if the search ran too long to tell."""
    open_bits = _open_bits(walls)
    cells_of = [i for _, i in sorted((n, i) for i, n in enumerate(numbers) if n)]
    last = len(cells_of)
    found: list[list[int]] = []
    path = [cells_of[0]]
    steps = 0

    def search(free: int, next_number: int) -> bool:
        nonlocal steps
        steps += 1
        if steps > MAX_STEPS:
            return False
        current = path[-1]
        if not free:
            if next_number > last:
                found.append(list(path))
            return True
        if not _connected(free, current):
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

    if not search(_ALL ^ (1 << cells_of[0]), 2):
        return None
    return found


def generate(rng: random.Random) -> tuple[dict[str, Any], list[int]]:
    while True:
        path = _random_path(rng)
        if path is None:
            continue
        ours = {frozenset(step) for step in zip(path, path[1:])}
        marked = {0, CELLS - 1, *rng.sample(range(1, CELLS - 1), START_NUMBERS - 2)}
        walls: list[list[int]] = []
        while len(marked) < CELLS:
            numbers = [0] * CELLS
            for rank, index in enumerate(sorted(marked), start=1):
                numbers[path[index]] = rank
            found = solutions(numbers, walls)
            if found is None:
                # Too many ways to tell quickly: one more number narrows it down.
                marked.add(rng.choice([k for k in range(CELLS) if k not in marked]))
                continue
            others = [p for p in found if p != path]
            if not others:
                return {"size": SIZE, "numbers": numbers, "walls": walls}, path
            # A wall where the other path passes and ours doesn't.
            theirs = [sorted(step) for step in zip(others[0], others[0][1:]) if frozenset(step) not in ours]
            walls.append(rng.choice(theirs))


def check(puzzle: dict[str, Any], solution: list[int], answer: Any) -> bool:
    """Any path that keeps the rules wins (there is only one, but the rules are what count)."""
    numbers: list[int] = puzzle["numbers"]
    if not isinstance(answer, list) or len(answer) != CELLS:
        return False
    if not all(isinstance(i, int) and not isinstance(i, bool) and 0 <= i < CELLS for i in answer) or len(set(answer)) != CELLS:
        return False
    open_bits = _open_bits(puzzle.get("walls", []))
    if any(not open_bits[a] >> b & 1 for a, b in zip(answer, answer[1:])):
        return False
    met = [numbers[i] for i in answer if numbers[i]]
    return met == list(range(1, max(numbers) + 1))


GAME = DailyGame(key="trilha", generate=generate, check=check)
