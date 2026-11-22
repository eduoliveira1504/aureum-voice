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
fixed UTC−3 (no daylight saving since 2019; the slim image has no tz database), and the games' day
turns at 1 a.m. there, not at midnight (Eduardo, 22/11). The first request
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
- *Caça-palavras* (12×12): 10 words of a theme from our own list (`app/daily/words.py`, written for
  the Aureum, no dependency), following a daily plan of directions: 5 diagonal (either way), 2
  across or down and 3 backwards, so no single reading finds them all (Eduardo found the first
  version too easy, 22/11). Filler letters are redrawn until every
  word reads in exactly one place and none of a short blocklist shows up by chance. The grid has no
  accents (Ç is C); the list shows the words as written.

**Results.** `daily_results`: one per person, game and day (time, attempts, completed). Attempts
are the wrong checks plus the right one, counted in Redis. The time comes from the app but is
capped by when the puzzle was first opened (also in Redis), so it can't be shortened by hand. A
game opened yesterday can still be finished today, as yesterday's; older days are closed.

**Home.** `GET /daily` gives today's results, the streak (days in a row with a finished game,
up to today, or up to yesterday while today isn't played yet), the friends who played today and,
per game, a ranking of the user and their friends by time alone (on the very same time, who
finished first; hints are shown next to the time but never weigh in, Eduardo 22/11). Tries aren't
shown anywhere: in Trilha and Caça-palavras the app never lets a wrong answer through. It's a challenge among friends (Eduardo, 22/11): the card shows "2º de 4", or the
best friend's time to beat before playing, and the result screen shows the whole ranking. Each
person sees only their own friends. A ranking inside a server comes with sharing.

**Sharing.** From the result, "Desafiar amigos" (each friend's DM) or "Desafiar no servidor" (a
text channel the user can write in, checked by the API like any message). It posts a message whose
embed is `{"addon_key": "daily", game, day, time_ms, attempts}`, never the answer, with a plain
text for apps that don't know the games. One challenge per game, day and channel
(`daily_shares`): the card's ranking covers everyone who sees the channel and played that day
(`GET /daily/{game}/ranking`), so a second one isn't needed. The card offers "Jogar" while it's
still today's, and shows the viewer's time once they played.

**Difficulty and hints (Eduardo, 22/11).** Each game's day is drawn easy, medium or hard (from
its own seed, so the same for everyone and with no weekday pattern): Sudoku gives 38, 32 or 27
numbers (a pass of single cells after the symmetric pairs reaches the target); Trilha is 5×5, 6×6
or 7×7 (the 7×7 search gets a bigger step budget, or it piles up numbers; up to ~6 s once a day,
off the event loop); Caça-palavras is 10×10 with 8 words, 12×12 with 10 or 14×14 with 12. A hint
every 30 seconds, made by the API from the solution and where the board is
(`POST /daily/{game}/hint`): a Sudoku number (a wrong one first), the Trilha's longest right
prefix and its next cell, where a missing word begins. Hints used are kept with the result
(`daily_results.hints`) and shown next to the time and in the ranking. Found words each get a color
(theme tokens `game-1..8`), a shared letter keeping the last word's.

**Where.** "Jogos do dia" is a page of its own, from Home's sidebar under Amigos (each game with
my result or "Jogar", the friends' podium, the time to beat and the streak); Home's card links to
it. The result screen shows the solved board right away, read-only, like an answer key: the
person's own solution (kept in `daily_results.answer`, only its owner gets it back), or the answer
key itself (`solution`, sent only to someone who finished that day) for results from before it
was kept. The Trilha board is one
SVG (every cell the same size, walls on the shared edge), after CSS borders misaligned it.

**Streaks and badges (block 4.2.13, Eduardo's choices of 22/11).** Each game has its own streak:
days in a row it was solved. Every 7 of them earn a freeze, up to 2 kept; a day without playing
spends one and the streak goes on without counting that day, and with none left it ends (today
only counts as missed once it's over). One badge per game follows the current streak, in levels of
3, 7, 30, 90, 180 and 365 days (`daily_<game>_<days>`, 18 in the catalog): it's granted or raised
after a solve and announced by @aureum, and an hourly sweep takes it away once the streak ends;
where it was featured, the new level keeps the place. The art is generated in code (the badges'
hexagon, the game's symbol, a plate with the days); the metal follows the level: bronze for 3 and
7, silver for 30 and 90, gold for 180 and 365. They top out at legendary: mythic stays for Fundador
and Pioneiro until Eduardo says otherwise. A name per level is still to be chosen. The profile's inventory
lists only the next level of each game, not all 18.

## Consequences

- Without Redis, the attempts count from 1 and the app's time is trusted.
- Friends see your time and tries in each day's games (that's the point of the ranking), and so
  does anyone in a channel where that game's challenge was shared that day.
- Themes and words are Portuguese in the English app too: it's a Portuguese word game.
- Crosswords are left for later: they need clues, and those need a licensed source.
