# 0012 — In-game overlay

- **Status:** accepted
- **Date:** 2026-10-18

## Context

Block 2.7 adds an overlay that shows who's in the call (and their cameras) over a game. Overlays like
Discord's or Steam's hook into the game's renderer (DLL injection into DirectX/Vulkan). Anti-cheat
systems flag that, and it would make Aureum a risk for every game its users play. The overlay must
also not get in the way of the game, its keys, or a screen share.

## Decision

**A window, not an injection**
- The overlay is a separate `BrowserWindow`: transparent, frameless, no shadow, no taskbar entry,
  `focusable: false`, always on top at the `'screen-saver'` level, and click-through with
  `setIgnoreMouseEvents(true, { forward: true })`. It shows with `showInactive()`, so it never takes
  focus from the game.
- **Limitation:** this only works over games in windowed or borderless mode. With exclusive
  fullscreen, Windows lets no other window draw on top, and we accept that.
- The window is sized to its content box, not the whole monitor. A full-screen topmost window makes
  Windows treat it as a fullscreen app (Focus Assist, hidden taskbar), and the compositor pays for the
  whole area.
- It hides while the app's own window has focus: it's for when the user is in another window.
- `setContentProtection(true)` (`WDA_EXCLUDEFROMCAPTURE`, Windows 10 2004+) keeps it out of screenshots
  and screen shares. The overlay shows other people's cameras, and they never agreed to be in the
  user's stream. This was tested on Windows 11 with an opaque test window using the same flags. With
  protection off, it appeared both in `desktopCapturer` thumbnails (the share picker) and in the
  `getDisplayMedia` stream. With protection on, it appeared in neither.

**Rendering: a popup of the app's window, not a second app**
- The app's window opens the overlay with `window.open('about:blank', 'aureum-overlay-…')`. The main
  process allows only that name, from only that window, and applies the options above. React renders
  into it through a portal, and the app's stylesheets and theme attributes are copied into it and
  kept in sync.
- Because the popup lives in the same renderer process, it reads the same stores (who's talking, who's
  muted) and plays the call's `MediaStreamTrack`s directly. The alternative was for the overlay to join
  the LiveKit room as a second participant, which would count twice against the LiveKit Cloud quota
  (participant minutes and download).
- **Adaptive stream:** while a game is in front, Windows reports the app's window as hidden, and LiveKit
  pauses every remote video. Overlay cameras are registered with LiveKit through its public
  `ElementInfo` API as picture-in-picture elements, visible only while the overlay document is. So
  they keep flowing at the small size they're drawn at, and nothing else in the hidden app window does.
  LiveKit picks the layer from the largest element showing a track. If the same camera is also big in
  the app's window, that size wins. That's acceptable, because cameras in the overlay are optional.

**Shortcuts and edit mode**
- The defaults are **Ctrl+Shift+F9** (show/hide) and **Ctrl+Shift+F10** (edit mode). A global shortcut
  takes the key away from every other program, so the defaults avoid:
  - letters with Ctrl+Alt, which is AltGr on ABNT2 and US-International layouts (AltGr+E = °,
    AltGr+Q = /, accented letters);
  - Shift+Tab (Steam), Alt+F9/F10/Z (NVIDIA), Ctrl+Shift+S/E/R (AMD), Win+Alt+… (Xbox Game Bar),
    and F12;
  - Discord's shortcuts.
- Both shortcuts can be changed in Settings > Overlay by pressing the new combination.
  - Accepted combos need a modifier with an F-key or a navigation key, or Ctrl/Alt with a letter or
    digit. F13–F24 work alone.
  - If another program already took a combo, the app says so and keeps the old one.
  - The current shortcuts pause while a new one is recorded.
- Edit mode makes the window take clicks and focus, with a dashed accent border. Dragging moves it, the
  corner handle resizes it, and Esc, Enter, Concluir or clicking back into the app ends it. Outside a
  call it shows a preview, so it can be placed before a game. Settings also has four corner buttons.
- The content hugs the screen corner the box is nearest to, so a box at the bottom right grows up and
  to the left.

**Preferences stay on this PC**
- The preferences are kept in `overlay.json` in the app's data folder: on/off, shortcuts, bounds, size,
  opacity (30–100%), show cameras, and only who's speaking. The position depends on this PC's
  monitors, so the preferences aren't synced through `user_settings`. Saved bounds are clamped back
  onto a monitor if the layout changes.
- "Only who's speaking" keeps a person up for 1.5 s after they stop, so they don't flicker between
  sentences.

## Consequences

- No API change and no migration.
- Exclusive-fullscreen games show no overlay. Users have to switch the game to borderless.
- Over a non-game window (a browser, say), the overlay also shows while the app isn't focused. The
  show/hide shortcut covers that. Gating it on the detected game (0010) could come later.
