"""Sudoku: a 9x9 grid where each row, column and 3x3 box holds 1 to 9 once.

A full grid is filled at random, then cells are emptied (in symmetric pairs) as long as the puzzle
keeps exactly one solution, down to CLUES given numbers. Cells are 0 (empty) to 9, row by row.
"""

import random
from typing import Any

from app.daily import DailyGame

SIZE = 9
CELLS = SIZE * SIZE
ALL = (1 << SIZE) - 1  # bits 0..8 stand for 1..9
# Given numbers by the day's difficulty: fewer is harder.
CLUES_BY = {"facil": 38, "medio": 32, "dificil": 27}
CLUES = CLUES_BY["medio"]


def _box(i: int) -> int:
    return (i // 27) * 3 + (i % 9) // 3


def _masks(grid: list[int]) -> tuple[list[int], list[int], list[int]] | None:
    rows, cols, boxes = [0] * SIZE, [0] * SIZE, [0] * SIZE
    for i, v in enumerate(grid):
        if v:
            bit = 1 << (v - 1)
            r, c, b = i // 9, i % 9, _box(i)
            if rows[r] & bit or cols[c] & bit or boxes[b] & bit:
                return None
            rows[r] |= bit
            cols[c] |= bit
            boxes[b] |= bit
    return rows, cols, boxes


def solutions(grid: list[int], limit: int = 2, rng: random.Random | None = None) -> list[list[int]]:
    """Up to `limit` solutions. With `rng`, candidates are tried in random order (to fill a grid)."""
    masks = _masks(grid)
    if masks is None:
        return []
    rows, cols, boxes = masks
    cells = list(grid)
    found: list[list[int]] = []

    def search() -> None:
        # The empty cell with the fewest candidates first.
        best, best_free, best_count = -1, 0, 10
        for i, v in enumerate(cells):
            if v:
                continue
            free = ALL & ~(rows[i // 9] | cols[i % 9] | boxes[_box(i)])
            count = free.bit_count()
            if count < best_count:
                best, best_free, best_count = i, free, count
                if count <= 1:
                    break
        if best < 0:
            found.append(list(cells))
            return
        digits = [d for d in range(SIZE) if best_free >> d & 1]
        if rng is not None:
            rng.shuffle(digits)
        r, c, b = best // 9, best % 9, _box(best)
        for d in digits:
            bit = 1 << d
            rows[r] |= bit
            cols[c] |= bit
            boxes[b] |= bit
            cells[best] = d + 1
            search()
            cells[best] = 0
            rows[r] &= ~bit
            cols[c] &= ~bit
            boxes[b] &= ~bit
            if len(found) >= limit:
                return

    search()
    return found


def generate(rng: random.Random, difficulty: str = "medio") -> tuple[dict[str, Any], list[int]]:
    target = CLUES_BY[difficulty]
    solution = solutions([0] * CELLS, limit=1, rng=rng)[0]
    givens = list(solution)
    pairs = list(range(CELLS // 2 + 1))  # i and its mirror 80 - i
    rng.shuffle(pairs)
    clues = CELLS
    for i in pairs:
        if clues <= target:
            break
        mirror = CELLS - 1 - i
        kept = givens[i], givens[mirror]
        givens[i] = givens[mirror] = 0
        if len(solutions(givens)) != 1:
            givens[i], givens[mirror] = kept
            continue
        clues -= 1 if i == mirror else 2
    # Symmetric pairs can stall above the target: single cells take it the rest of the way.
    singles = [i for i in range(CELLS) if givens[i]]
    rng.shuffle(singles)
    for i in singles:
        if clues <= target:
            break
        kept = givens[i]
        givens[i] = 0
        if len(solutions(givens)) != 1:
            givens[i] = kept
            continue
        clues -= 1
    return {"size": SIZE, "difficulty": difficulty, "givens": givens}, solution


def check(puzzle: dict[str, Any], solution: list[int], answer: Any) -> bool:
    """The answer is the whole grid; the solution is unique, so it must match it."""
    if not isinstance(answer, list) or len(answer) != CELLS:
        return False
    return all(isinstance(v, int) and not isinstance(v, bool) for v in answer) and answer == solution


def hint(puzzle: dict[str, Any], solution: list[int], state: Any, rng: random.Random) -> dict[str, Any]:
    """One number of the solution: a wrong one first (to fix it), else an empty cell."""
    cells = state if isinstance(state, list) and len(state) == CELLS else list(puzzle["givens"])
    wrong = [i for i, v in enumerate(cells) if v and v != solution[i] and not puzzle["givens"][i]]
    empty = [i for i, v in enumerate(cells) if not v]
    cell = wrong[0] if wrong else rng.choice(empty) if empty else 0
    return {"cell": cell, "value": solution[cell]}


GAME = DailyGame(key="sudoku", name="Sudoku", generate=generate, check=check, hint=hint)
