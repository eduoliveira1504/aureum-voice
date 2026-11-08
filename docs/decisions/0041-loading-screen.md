# 0041 — Loading screen

- **Status:** accepted
- **Date:** 2026-11-08

## Context

Block 3.23: when the app opens, a small loading screen with the logo spinning like a coin shows
first, checks for an update and gives way to the main window once it's ready. Before this block the
main window appeared on `ready-to-show` with a spinner inside, and starting with Windows always meant
hidden in the tray (`--hidden`).

## Decision

**Its own light page**
- `splash.html` is a second renderer page (electron-vite multi-page) with its own preload
  (`preload/splash.ts`). Plain DOM and CSS, no React, so it paints in about 0.3 s. It only listens:
  `splash:status` (the line under the coin) and `splash:leave` (fade). It can't call anything.
- A frameless transparent 300×360 window; the page draws the rounded card in the dark theme's colors
  (the user's theme isn't known yet). The coin is the official logo used as a CSS mask over a gold
  gradient, with front, back and three darker layers for the edge. `prefers-reduced-motion` swaps
  the spin for a gentle pulse.

**Who decides**
- `main/startup.ts` holds the rules and doesn't import Electron (tested with fake timers). index.ts
  feeds it three things: the screen appeared (`shown`), the updater's phases (`update`) and the main
  window's `app:ready(online)`, sent by AuthProvider once the session is restored or known to be
  unreachable. It answers with a status line, "open" or "install".
- The main window loads hidden from the start. It's shown when: the screen has been up at least
  1.2 s (counted from when it appears, so a slow Electron start doesn't eat it), the window reported
  ready, and the update question is settled. At 10 s from the start it opens anyway.
- The app always waits for the screen to appear: without a saved session the window is ready before
  the screen paints, and skipping it would make the screen depend on luck.
- Closing the screen by hand quits: nothing else of the app is on screen yet. Opening the app again
  while it's up only focuses it.

**Updates**
- The updater (electron-updater, same GitHub channel) reports each step to the screen. The check gets
  5 s. A version downloaded while the screen is up installs silently and the app reopens on it,
  through the screen again.
- While downloading, each bit of progress allows 10 s more, up to 90 s from the start. A stalled or
  slow download, a failed check or a check past 5 s let the app open; the updater keeps going in the
  background and the window offers "Reiniciar para atualizar", as before. Never in development.
- Errors that mean no internet (Chromium's `net::ERR_INTERNET_DISCONNECTED` and friends, DNS
  failures) show "Sem conexão, abrindo mesmo assim…"; other update failures stay silent.

**Starting with Windows**
- The login item now passes `--login`, and the "Ao ligar o PC" choice (`loginStart`: `window` by
  default, or `tray`) is read at launch. The old `--hidden` registration is treated the same way, so
  people who had it on move to the new default on their next boot, before the app re-registers.

## Consequences

- One more window and preload; the permission and IPC checks still only trust the main window.
- An update can take up to ~90 s of loading screen on a slow connection, always with the percentage
  moving; it never blocks past that.
- The end-to-end update path (real installer, real feed) is only tested by hand; the timing and
  phase rules are covered by unit tests with a fake updater.
- macOS (3.21) reuses the same page and rules.
