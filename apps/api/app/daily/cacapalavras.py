"""Caça-palavras: a 12x12 grid of letters hiding the day's words (a theme from app/daily/words.py),
in a straight line in any of the 8 directions. Find them all.

Each day has a plan of directions, mostly diagonal (both ways), with a few across and down, forwards
and backwards, so no single reading finds them all. Words are placed at random following it; the
other cells get random letters, redrawn until each word shows up exactly once in the grid (so every
word has a single place) and no blocked word appears by chance. Letters have no accents (Ç is C);
the list shows the words as written.
"""

import random
import unicodedata
from typing import Any

from app.daily import DailyGame
from app.daily.words import THEMES

SIZE = 12
CELLS = SIZE * SIZE
WORDS = 10
FORWARD = [(0, 1), (1, 0)]
BACKWARD = [(0, -1), (-1, 0)]
DIAGONAL = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
DIRECTIONS = FORWARD + DIAGONAL[:2] + BACKWARD + DIAGONAL[2:]
# The day's plan, one kind per word: half diagonal, the rest split between forwards and backwards.
PLAN = [DIAGONAL] * 5 + [FORWARD] * 2 + [BACKWARD] * 3
# Filler letters, roughly as often as in Portuguese.
FILL = "AAAAAAAAAAAAAAEEEEEEEEEEEEOOOOOOOOOOSSSSSSSRRRRRRIIIIIINNNNNDDDDDMMMMMUUUUUTTTTCCCCLLLPPPVVGGHQBBFZJX"
# Nothing like these may show up by chance, in any direction.
BLOCKED = ("PUTA", "MERDA", "PORRA", "CARALHO", "BOSTA", "FODA", "BUCETA", "CACETE", "VIADO", "CUZAO", "PIROCA", "XOTA")


def plain(word: str) -> str:
    """As in the grid: capitals, no accents, Ç as C."""
    return "".join(ch for ch in unicodedata.normalize("NFD", word.upper()) if not unicodedata.combining(ch))


def _line(start: int, direction: tuple[int, int], length: int) -> list[int] | None:
    r, c = divmod(start, SIZE)
    dr, dc = direction
    end_r, end_c = r + dr * (length - 1), c + dc * (length - 1)
    if not (0 <= end_r < SIZE and 0 <= end_c < SIZE):
        return None
    return [(r + dr * k) * SIZE + c + dc * k for k in range(length)]


def occurrences(grid: list[str], word: str) -> set[frozenset[int]]:
    """Every place a word reads in a straight line (a palindrome's two readings are one place)."""
    found: set[frozenset[int]] = set()
    for start in range(CELLS):
        if grid[start] != word[0]:
            continue
        for direction in DIRECTIONS:
            cells = _line(start, direction, len(word))
            if cells and all(grid[i] == ch for i, ch in zip(cells, word)):
                found.add(frozenset(cells))
    return found


def _place(rng: random.Random, words: list[str]) -> tuple[list[str], list[list[int]]] | None:
    grid = [""] * CELLS
    lines: list[list[int]] = []
    plan = list(PLAN)
    rng.shuffle(plan)
    for word, kinds in zip(words, plan):
        options = [(s, d) for s in range(CELLS) for d in kinds]
        rng.shuffle(options)
        for start, direction in options:
            cells = _line(start, direction, len(word))
            if cells and all(grid[i] in ("", ch) for i, ch in zip(cells, word)):
                for i, ch in zip(cells, word):
                    grid[i] = ch
                lines.append(cells)
                break
        else:
            return None
    return grid, lines


def generate(rng: random.Random) -> tuple[dict[str, Any], list[list[int]]]:
    while True:
        theme = rng.choice(sorted(THEMES))
        pool = sorted({plain(w): w for w in THEMES[theme] if 4 <= len(plain(w)) <= SIZE}.items())
        if len(pool) < WORDS:
            continue
        chosen = sorted(rng.sample(pool, WORDS), key=lambda p: -len(p[0]))
        placed = _place(rng, [p for p, _ in chosen])
        if placed is None:
            continue
        base, lines = placed
        for _ in range(30):
            grid = [ch or rng.choice(FILL) for ch in base]
            if all(len(occurrences(grid, p)) == 1 for p, _ in chosen) and not any(
                occurrences(grid, b) for b in BLOCKED
            ):
                break
        else:
            continue
        # The list in alphabetical order, each with where it is.
        by_word = sorted(zip(chosen, lines), key=lambda x: x[0][1])
        puzzle = {
            "size": SIZE,
            "theme": theme,
            "rows": ["".join(grid[r * SIZE:(r + 1) * SIZE]) for r in range(SIZE)],
            "words": [shown for (_, shown), _ in by_word],
        }
        return puzzle, [[cells[0], cells[-1]] for _, cells in by_word]


def check(puzzle: dict[str, Any], solution: list[list[int]], answer: Any) -> bool:
    """For each word in the list, [first cell, last cell] of a straight line that reads it (either way)."""
    words: list[str] = puzzle["words"]
    grid = "".join(puzzle["rows"])
    if not isinstance(answer, list) or len(answer) != len(words):
        return False
    for word, pair in zip(words, answer):
        if not (isinstance(pair, list) and len(pair) == 2 and all(isinstance(i, int) and not isinstance(i, bool) and 0 <= i < CELLS for i in pair)):
            return False
        (r1, c1), (r2, c2) = divmod(pair[0], SIZE), divmod(pair[1], SIZE)
        target = plain(word)
        steps = max(abs(r2 - r1), abs(c2 - c1))
        if steps != len(target) - 1 or (r1 != r2 and c1 != c2 and abs(r2 - r1) != abs(c2 - c1)):
            return False
        dr, dc = (r2 > r1) - (r2 < r1), (c2 > c1) - (c2 < c1)
        read = "".join(grid[(r1 + dr * k) * SIZE + c1 + dc * k] for k in range(len(target)))
        if read not in (target, target[::-1]):
            return False
    return True


GAME = DailyGame(key="cacapalavras", name="Caça-palavras", generate=generate, check=check)
