# 0024 — Overlay only over games, and watching a screen share on request

- **Status:** accepted
- **Date:** 2026-10-25
- **Phase 3, block 3.6**
- Replaces the "Not over browsers and other apps" part of 0012.

## Context

Two complaints from the beta. The overlay showed over any program outside a short list of
exceptions, so it popped up over game clients and launchers (the League of Legends client, Steam)
and over apps nobody plays. And the call connected with LiveKit's `autoSubscribe` on, so everyone
received the video and audio of a screen share the moment someone started it, whether they wanted
it or not. That costs LiveKit Cloud quota, and nobody should hear a stream they didn't ask for.

## Decision

**The overlay shows only over a game.** The rule lives in `src/shared/overlayRule.ts`, as pure
functions with tests. The program in front must be one of these:
- a known game: the bundled `games.json` (always the executable of the match itself, never a
  launcher or client) plus the games the user added for game activity (0010);
- or a program the user added in Settings › Overlay ("Jogos com overlay").

Anything else hides the overlay. The exceptions (`src/shared/overlayExceptions.json`) now also list
launchers and clients (Riot Client, LeagueClientUx, Steam, Epic, Battle.net, EA app, Ubisoft
Connect, Xbox app…). They still win over everything, so a program added as a game by mistake still
gets no overlay. "Ocultar overlay neste jogo" still works, and a known game can be hidden from the
searchable list in Settings.

Some games are told apart by window title (Minecraft on `javaw.exe`). The overlay never reads
titles, so such a game counts only while game detection (0010) has found it. When Windows won't
name the program in front (some anti-cheats protect their process), the overlay shows only if game
detection sees a known game running.

**An unknown game gets one question.** The question comes during a call with the overlay on,
when an unknown program covers its whole monitor. Only the window's rectangle is compared with the
monitor's, through `GetWindowRect` and `GetMonitorInfoW`. A maximized window doesn't count: it stops
at the taskbar. The overlay then shows "Isso é um jogo? Mostrar o overlay em <programa>" with
Mostrar / Não é jogo. The answer is saved (`games` or `notGames` in the overlay preferences, on this
PC). Unanswered, the question goes away after 20 s and comes back at most once per call. Nothing
turns on by itself. The overlay window stays click-through and unfocusable. It takes clicks only
while the pointer is over the question, so answering never takes focus from the game.

**Privacy is unchanged.** Only the executable's file name and, for the question, the window
rectangle are read. Neither is ever logged or sent to the server. To show the question, the program's
name goes to the app's own window, like the program list Settings already shows.

**A screen share is received only after "Assistir".** The room connects with
`autoSubscribe: false`. The app subscribes to microphones and cameras by itself, and to
`ScreenShare` + `ScreenShareAudio` only for the people in `watching`. A shared screen shows as a card
first: "fulano está transmitindo", AO VIVO, and Assistir. "Parar de assistir" on the tile drops both
subscriptions, and a share that ends resets it. The sharer's own tile stays as it was, shown once.

**The card's preview and the count go over LiveKit data, not the API.** The sharer already
captures a 320×180 frame for the overview thumbnails, now every 5 s. The same frame, scaled to
160×90, goes to the room as a reliable data message (`aureum.screen-preview`). It's about 5 KB, has
no audio and works in private calls too. The card shows it blurred. Viewers send
`aureum.screen-watch {watching}` to the sharer alone, whose tile shows "N assistindo". LiveKit sets
the sender's identity, so it can't be faked. Malformed or oversized messages are ignored.

## Consequences

- No API change and no migration. The token already allowed data messages.
- Older apps (0.2.0-beta.5.5) still subscribe to everything and don't send "watching". They keep
  working, but a sharer on the new version doesn't count them as viewers.
- The overlay no longer shows over a game it doesn't know until the user adds it or answers the
  question. That's the price of never showing it over a launcher.
- Manual tests to do: the LoL client and the Steam launcher (no overlay); a LoL match and another
  listed game in borderless window (overlay); Vivaldi, Spotify and WhatsApp, fullscreen too (no
  overlay); an unlisted game in fullscreen (asked once, answer respected). With 3 people in a call
  and one sharing: the others get no screen video or audio until Assistir (check the subscriptions
  in LiveKit). Parar de assistir cuts both. The sharer sees the count.
