# 0042 — Overlay cameras that size themselves

- **Status:** accepted
- **Date:** 2026-11-08

## Context

Block 3.14 (ADR 0040) gave the cameras widget a horizontal or vertical layout and three tile sizes.
In practice only "how many fit vertically" seemed to change anything. The box was a fixed window
(200×400 by default, or whatever was dragged) with the overflow cut off, and the tiles had a fixed
width:

- Vertical was a wrapping column with no definite height, so it never wrapped. Stretching the box only
  showed or cut cameras at the bottom.
- Tiles were capped at the box's width: in the default box (184 px inside) "Grande" (229 px) came out
  almost the same as "Médio" (176 px), and "Pequeno" just made room for one more camera.
- Edit mode with nobody's camera on showed a single sample, so horizontal and vertical looked the same.
  In a call, a horizontal row wrapped when the box ran out and the second line was cut off.

Block 3.22 part A asks for vertical, horizontal or grid, a continuous camera size, a maximum count with
"+N", speakers always visible, spacing and rounded corners, and a box that follows all of it.

## Decision

**The box follows its cameras**
- `cameraLayout` (shared/overlayWidgets.ts) is the only place that turns preferences and a camera count
  into columns, rows, tile size and box size. The app's window uses it to draw. The main process uses it
  to size the widget's window, after the app tells it how many cameras it draws (`setCameraCount`).
- The saved position (per monitor, as in 0040) now only says where the box is pinned. The box keeps the
  edges of the screen corner the saved box is nearest to, so it grows and shrinks away from that corner.
  A box that was never placed grows down from its default place under the voice list. The main process
  tells the app which corner it is (`OverlayState.cameraCorner`), so the edit handle sits on the free
  side and drags in the right direction.
- A box too big for the monitor shrinks its cameras to fit instead of cutting them off.
- Switching the layout no longer rotates the saved box (0040). The box is resized from its cameras.

**Preferences**
- New fields in `overlay.json` for the cameras: `layout` (adds `grid`), `tileWidth` (96–360 px, 16:9),
  `maxVisible` (1–8, default 4), `perRow` (1–8, grid only, default 2), `gap` (0–16 px, default 6) and
  `rounded` (default on).
- Pequeno, Médio and Grande are shortcuts to the widths from before this block (141, 176 and 229 px), so
  a file from before keeps its exact size: its `size` becomes `tileWidth`. `size` stays in the file
  and follows the nearest shortcut, so an older version reading the file still finds a valid value.
- The cameras' box has a smaller minimum (one small camera) than the other widgets.

**Who shows**
- In the call's order, up to `maxVisible`. Whoever is speaking always shows, even past the limit, and
  is held for 1.5 s after they stop so pauses don't reshuffle the cameras. Speaking highlights didn't
  change.
- What's left out is a "+N" badge on the last camera, not an extra tile, so the box math stays the
  same with and without it.

**Editing**
- Settings › Overlay › Câmeras has every option, with a preview of the box at its biggest (`maxVisible`
  sample cameras), drawn to scale when it doesn't fit the column.
- Edit mode (Ctrl+Shift+F10) shows the same number of sample cameras when nobody has a camera on. Its
  bar switches the format and steps the count (and per row, in the grid). The handle changes the width
  of each camera: the drag is shared by the columns across, or by the rows down, whichever moved more.
  Spacing and corners are only in Settings.

## Consequences

- No API change and no migration. Going back to an older version reads `size` and the layout (a grid
  becomes vertical) and ignores the rest.
- Each change of count resizes a window. That happens when a camera turns on or off, or when a speaker
  outside the visible ones starts talking. It doesn't happen on every frame.
- How the windows look over a real game, on several monitors, can't be covered by automated tests.
  The rules are in `shared/overlayWidgets.ts` and tested, and the rest is in the manual test of block
  3.22.
