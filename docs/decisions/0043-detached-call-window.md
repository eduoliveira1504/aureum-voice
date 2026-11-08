# 0043 — Detached call window

- **Status:** accepted
- **Date:** 2026-11-08

## Context

The floating call window (the "janelinha") lives inside the app's window. When Aureum is minimized or
behind another program, the call can't be seen at all. Block 3.20 part B asks to detach the call into a
window of its own. That window is frameless, stays above other programs (the user can turn that off),
can be resized and dragged, and remembers its position, size and monitor.

The hard requirement is that media is not duplicated. A second LiveKit connection would make the user
appear twice in the room and count twice against the media quota. It would also download every track
twice.

## Decision

**Same process, same room**
- The app's window opens the detached window with `window.open('about:blank', 'aureum-call-<n>')` and
  renders into it with a React portal, the same way as the overlay's widgets (ADR 0012, 0040).
- An `about:blank` popup of the same origin runs in the opener's renderer and JS context. The portal
  reads the same stores (`useVoice`, `useNav`) and plays the `Track` objects of the room that already
  exists. Nothing in it calls `join` or `room.connect`, and a test checks that.
- IPC calls made from the popup's UI still go through the app window's preload bridge. The main
  process's sender check (`event.sender === mainWindow.webContents`) didn't change.
- Remote video uses `PopupVideo` (moved out of the overlay). It registers the element with LiveKit's
  adaptive stream at its real size, with visibility taken from the popup's own document. A small window
  gets the low simulcast layer, and video keeps flowing while the app's window is minimized.

**The window (main process, `callWindow.ts`)**
- `setWindowOpenHandler` allows only `about:blank` from the app's window with a name matching
  `aureum-call-<digits>`, with `frame: false`, resizable, minimum 240×135 and not maximizable.
- "Fixar por cima" uses `setAlwaysOnTop(pinned, 'floating')`: above normal windows and below the overlay
  (`'screen-saver'`). It's a normal window, not the overlay. It never shows over a game in exclusive
  fullscreen and reads nothing from the game. It also isn't hidden from screen capture: like the app's
  own window, it shows up if the user shares the screen it's on.
- Position, size and the pin are saved in `call-window.json` (userData). On open, the saved box is used
  if its center is inside some monitor's work area, shrunk to fit if needed. Otherwise the window opens
  at the bottom-right of the main monitor. The rules are in `shared/callWindow.ts` and tested.
- Not a child window, so it doesn't minimize with the app. It closes with the app's window.

**Behaviour (renderer, `DetachedCall.tsx`)**
- "Destacar chamada" is in the call's control bar and in the floating window. `useNav.callDetached` is
  the only state. While it's set the floating window hides, and a call open in a panel stays as it is.
- Content: the same subject as the floating window (someone else's screen, else who's speaking), or a
  grid of everyone (Foco/Grade). Each tile has the 3.19 ring and video in `object-contain`. A header
  (room, Foco/Grade, pin, "Voltar ao app", X) and a compact bar (mic, headphones, camera, screen,
  Painel de sons, leave) float over the video while the pointer is over the window.
- It can be dragged by any part that isn't a control, like the floating window (3.20 A). The renderer
  sends screen positions over IPC (`call-window:move`). Windows' native drag area isn't used because it
  would swallow clicks. The window's edges resize it.
- The X, "Voltar ao app" (which also brings the app forward) and closing it from outside (Alt+F4) all
  go back to the floating window without leaving the call. Leaving the call closes it.
- Call popovers (the Painel de sons) open in the window their button is in, narrower if needed. The
  screen picker is too big for a small window, so it opens in the app's window, which comes forward.
  The device arrows stay in the app.

## Consequences

- No API change and no migration. The only new file on disk is `call-window.json`.
- The popup shares the app's renderer, so a crash or reload of the app's page also closes it. That's
  intended: there's no call without the app's page.
- Automated tests cover opening and closing without leaving the call, no second connection, Foco/Grade,
  the pin, dragging, and the window bounds rules. How it behaves on several monitors, with the app
  minimized and over other programs is part of the manual test.
