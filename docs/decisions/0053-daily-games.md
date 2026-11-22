# 0053 — Daily games on Home

- **Status:** accepted (Sudoku done; Trilha, Caça-palavras and sharing to follow)
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

**Single solution.** Each generator is paired with a solver. Sudoku fills a full grid at random,
then empties cells in symmetric pairs while the solver still finds exactly one solution, down to
32 clues (about 10 ms).

**Results.** `daily_results`: one per person, game and day (time, attempts, completed). Attempts
are the wrong checks plus the right one, counted in Redis. The time comes from the app but is
capped by when the puzzle was first opened (also in Redis), so it can't be shortened by hand. A
game opened yesterday can still be finished today, as yesterday's; older days are closed.

**Home.** `GET /daily` gives today's results, the streak (days in a row with a finished game,
up to today, or up to yesterday while today isn't played yet) and the friends who played today
(friends only, game keys only). The card lists the games with "Jogar" or the result.

## Consequences

- Without Redis, the attempts count from 1 and the app's time is trusted.
- Friends see that you played today and which games; your time stays yours until you share it.
