# 0053 — Daily games on Home

- **Status:** accepted
- **Date:** 2026-11-22

## Context

Block 4.2.10: a "Jogos do dia" card on Home, with one puzzle a day per game, the same for
everyone, a streak and which friends already played. No AI, nothing copied from LinkedIn's games,
no paid service. Eduardo's choices (22/11): Sudoku, Trilha (a path through every cell, joining the
numbers in order) and Caça-palavras in this round, crosswords later; the word list is our own;
the puzzle is made and checked by the API.

## Decision

**Made by the API.** `app/daily` holds one module per game with `generate(rng)` and
`check(puzzle, solution, answer)`. The random source comes from the Brasília day
(`sha256("aureum-daily:<game>:<day>")`), so the puzzle is the same for everyone. Brasília is a
fixed UTC−3 (no daylight saving since 2019; the slim image has no tz database). The first request
of the day saves it in `daily_puzzles`, so a restart or a new Python version never changes it
mid-day. The app gets the puzzle only; answers are checked by the API, so nobody records a solve
they didn't make, and there is a single generator for every client.

**Single solution.** Each generator is paired with a solver.
- *Sudoku* fills a full grid at random, then empties cells in symmetric pairs while the solver
  still finds exactly one solution, down to 32 clues (about 10 ms).
- *Trilha* (6×6): a random path through every cell, with its ends and 5 cells along it numbered.
  While a bitmask search finds another path that fits, a wall goes on a step that path takes and
  ours doesn't, which rules it out for good; when the search can't tell within its step budget, one
  more number is added. In practice: 7 numbers, 1 to 9 walls, under 0.2 s. Any path that keeps the
  rules is accepted.
- *Caça-palavras* (10×10): 8 words of a theme from our own list (`app/daily/words.py`, written for
  the Aureum, no dependency), in any of the 8 directions. Filler letters are redrawn until every
  word reads in exactly one place and none of a short blocklist shows up by chance. The grid has no
  accents (Ç is C); the list shows the words as written.

**Results.** `daily_results`: one per person, game and day (time, attempts, completed). Attempts
are the wrong checks plus the right one, counted in Redis. The time comes from the app but is
capped by when the puzzle was first opened (also in Redis), so it can't be shortened by hand. A
game opened yesterday can still be finished today, as yesterday's; older days are closed.

**Home.** `GET /daily` gives today's results, the streak (days in a row with a finished game,
up to today, or up to yesterday while today isn't played yet), the friends who played today and,
per game, a ranking of the user and their friends (shortest time, then fewer attempts, then who
finished first). It's a challenge among friends (Eduardo, 22/11): the card shows "2º de 4", or the
best friend's time to beat before playing, and the result screen shows the whole ranking. Each
person sees only their own friends. A ranking inside a server comes with sharing.

**Sharing.** From the result, "Desafiar amigos" (each friend's DM) or "Desafiar no servidor" (a
text channel the user can write in, checked by the API like any message). It posts a message whose
embed is `{"addon_key": "daily", game, day, time_ms, attempts}`, never the answer, with a plain
text for apps that don't know the games. One challenge per game, day and channel
(`daily_shares`): the card's ranking covers everyone who sees the channel and played that day
(`GET /daily/{game}/ranking`), so a second one isn't needed. The card offers "Jogar" while it's
still today's, and shows the viewer's time once they played.

## Consequences

- Without Redis, the attempts count from 1 and the app's time is trusted.
- Friends see your time and tries in each day's games (that's the point of the ranking), and so
  does anyone in a channel where that game's challenge was shared that day.
- Themes and words are Portuguese in the English app too: it's a Portuguese word game.
- Crosswords are left for later: they need clues, and those need a licensed source.
