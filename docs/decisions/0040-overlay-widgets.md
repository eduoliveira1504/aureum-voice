# 0040 — Overlay widgets

- **Status:** accepted
- **Date:** 2026-11-01

## Context

Block 3.14 splits the overlay (0012, 0024) into three independent widgets: voice, cameras and
notifications. Each one has its own position, size and opacity, can be switched off, and keeps a
position per monitor. Everything from 0012 and 0024 still holds: only over games, click-through, no
injection, kept out of captures.

## Decision

**One window per widget**
- Each widget is its own popup (`aureum-overlay-<widget>-<n>`), rendered through a portal as before.
  A single window holding the three would have to span the monitor, which 0012 rules out (Windows
  treats it as a fullscreen app, and the compositor pays for the whole area). Separate windows also
  let a widget sit on another monitor.
- A window exists only while it has something to show: cameras while someone has a camera on,
  notifications while one is up.
- The shortcut's messages and "Isso é um jogo?" aren't part of any widget. They stay in the voice
  window, which opens for them even with the voice widget off.
- With every widget off, the program in front isn't watched, nothing asks "Isso é um jogo?" and edit
  mode doesn't open.

**Positions per monitor**
- The widgets go to the monitor of the game in front, read from its window rectangle. Away from a game
  (placing them from Settings), it's the monitor the pointer is on.
- `positions` maps a display id to a box. A monitor with no saved box uses the widget's default place
  on it. The box is stored in absolute coordinates, so a widget can be left on a second monitor while
  the game runs on the first. Boxes are clamped back onto a monitor if the layout changes, and each
  widget remembers up to 8 monitors.
- Switching the cameras' layout rotates the saved boxes, so the tiles keep fitting.

**Preferences**
- Same `overlay.json`, still local. A file from before this block is migrated on load: the single box
  becomes the voice widget in the same place, its size and opacity go to voice and cameras, and
  "Mostrar câmeras" becomes the cameras widget's on/off. Notifications start on, with content shown.

**Notifications**
- Sources: the same rule as the message sound (DMs and groups unless silenced, mentions anywhere, not
  the conversation on screen nor the chat of the call we're in), a call ringing, and people joining or
  leaving the call we're in. Joins and leaves come from comparing the room while connected, so a
  reconnect doesn't report everyone leaving and coming back.
- They last 5 s, at most 4 at a time. Nothing shows in "Não perturbe" or while the app itself is in
  front. A call that rings isn't answerable here: the overlay stays click-through.
- **They also work outside a call**, because "chamada recebendo" mostly happens outside one. That
  changes the privacy rule of 0012 in one narrow way: the check of the program in front now also runs
  while a notification is up (about 5 s), on top of during a call. It reads the same thing, only the
  file name and the window rectangle, and nothing leaves the main process. Settings says so. The key
  watch didn't change: it still runs only in a call.

**Window focus state**
- `mainFocused` now starts false. Opened hidden at login (`--hidden`), the window gets no focus event
  until it's shown, and starting true would have kept notifications from ever showing.

## Consequences

- No API change and no migration; `overlay.json` migrates by itself. Going back to an older version
  loses the positions (it reads none of the new fields and uses its defaults).
- Three popups at most, each with a copy of the app's stylesheets.
- Exclusive-fullscreen games still show no overlay, notifications included.
- Which monitor a game is on, and how windows behave over a real game, can't be covered by automated
  tests: the rules are in `shared/overlayWidgets.ts` and tested, and the rest is in the manual test of
  block 3.14.
