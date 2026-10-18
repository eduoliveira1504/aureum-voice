# 0010 — Rich profiles and automatic "Jogando X"

- **Status:** accepted
- **Date:** 2026-10-18

## Context

Block 2.5 adds new profile fields: pronouns, a custom status with an emoji and an expiry, an avatar
frame, a profile song, up to 5 links and system badges. It also asks for a "Jogando X" line that turns
on by itself when a game is open.

The project must stay free, so paid game databases and APIs are out (for example the lists that game
SDKs or launchers expose). Privacy matters too: the app must send nothing but the game's name.

## Decision

### Profile fields

- The new fields are columns on `users`: `pronouns`, `avatar_frame`, `custom_status`, `favorite_song`,
  `links` and `badges`. The last four are JSONB because they're small, always read with the user and
  never queried on their own.
- `users.accent_color` (phase 1) stays the profile card color, so there's no separate
  `profile_color` column. The UI accent lives in `user_settings.accent_color`.
- **Links and the song URL** must be `https://` with a host, checked by Pydantic and mirrored in the
  form. There can be at most 5 links. Anything else is rejected with 422.
- **Custom status:** stored as `{text, emoji, expires_at}`. When it expires, `UserPublic` returns
  `null`, so nobody sees it, but it stays in the database until replaced. No job has to clear it.
  Clients also hide it on a timer at `expires_at`, so it disappears live without a server event.
- **Avatar frames** are `none`, `accent` (the profile color) or one of the five accent presets. The
  server keeps only the key, and the app owns the colors.
- **Badges** can't be changed through the API: `UserUpdate` has no `badges` field. They're granted from
  the server shell with `python -m app.cli badges grant|revoke|list <username> [badge]`, which also sends
  `user.updated` so open clients refresh. Known keys: `founder`, `beta`.

### Game activity

- **Detection runs in the Electron main process.** Every 20 s it lists the programs that have a main
  window. It does this with PowerShell `Get-Process` (output forced to UTF-8), so no native modules are
  needed. Each run takes about 0.3 s. Programs without a window are ignored, so background services
  never match.
- **Matching** checks the executable name, case-insensitive, against
  `apps/desktop/src/main/games.json` (~130 popular PC games, `{name, exe[], title?}`) plus the games the
  user added. Games on a generic runtime (Minecraft Java on `javaw.exe`) also need their window title to
  match a regex. While a game stays open it keeps being shown, even if another known one starts.
- **Preferences stay on the PC** (`userData/games.json`): on/off, the user's own games, hidden games and
  a manual activity. Executables differ per install and say a lot about a PC, so they're not synced.
  The process list is shown only in the user's own Settings window, to pick a game from.
- **Only the name leaves the PC.** The renderer sends `activity.set {name}` (or `null`) over the
  existing WebSocket, and only when it changes. A manual activity, while set, wins over the detected
  game.
- **The server keeps activities in Redis only**, in a hash per user with one entry per connection. The
  user's activity is the most recently started one. An entry goes away with its connection, and nothing
  touches Postgres. The start time is kept while the name stays the same, so "for 2 h" is accurate.
- **Events:**
  - `activity.updated` goes to the user's audience (`audience_ids`, the same people who get presence)
    only when the visible activity changes.
  - `presence.updated` carries the activity, so going invisible or offline hides it and coming back
    shows it again.
  - Each new connection gets an `activity.snapshot` right after `ready`.
- Names are trimmed, whitespace collapsed and cut to 64 characters on the server, whatever the
  client sends.

## Consequences

- No paid or third-party service. Anti-cheat software doesn't object, because the app only reads the
  process list the OS already shows and never touches a game's process.
- The bundled list is best-effort. A game missing from it, or one whose executable changed, can be added
  in Settings > Atividade by picking it from the open programs.
- People who join a server mid-session see co-members' current games on the next activity change or
  reconnect, not instantly. That's acceptable for a small group.
- Exclusive-fullscreen games still have a main window, so they're detected too.
