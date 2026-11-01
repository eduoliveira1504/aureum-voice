# 0039 — Up to four panels in a tree

- **Status:** accepted
- **Date:** 2026-11-01

## Context

Block 3.13: from two panels side by side to up to four, in any arrangement of rows and columns. The
beta has people on the previous app version, and they share the saved layout with this one: settings
sync between devices, and the API goes up before the release.

## Decision

### The tree sits next to the old fields

`PanelLayout` gains `tree`, a binary tree of divisions (`dir`, `ratio`, `a`, `b`) whose leaves are
indexes into `panels`. `panels` and `split` stay, because the previous version reads them. A layout
without a tree is read as a row, so saved layouts of two panels look the same, and `split` follows
the root's ratio when the root is a row.

The API checks the tree's shape, not that it fits `panels`. The previous version rewrites `panels`
and carries the tree along, so checking would answer 422 to it for doing nothing wrong. The app
compares the two on read (`matches`) and rebuilds a row when they differ. That loses the arrangement
but never a tab.

With four panels saved, the previous version shows them all in one row. That's ugly but works.

### Leaves don't say where a panel is

Panel 0 is the one with the overview, wherever it sits: splitting it on the left puts a new panel
before it on screen and after it in `panels`. So the overview rule didn't change.

### What moves a tab

`dropTab` replaces `moveTab` and the two ways of opening. It moves a tab that's open and opens one
that isn't, in a panel or on its edge, at a position or at the end. Taking the only tab out of a
panel frees its place, so a full layout can still be rearranged; only a real 5th panel warns.

"Dividir" has to put something in the new panel, because panels are never empty: it moves the active
tab, or the last one when the overview is active. With a single tab there's nothing to move, and the
buttons are disabled. Middle click and Ctrl+click on a channel used to mean "the other panel", which
stops making sense with four; they now mean "new panel", like the menu.

### Small windows and maximizing are never saved

Both work out what to show from the saved layout, on every render. Folding removes leaves from a
copy of the tree, choosing along the direction that doesn't fit, so a 2×2 grid without height
becomes two columns instead of one panel. The bar's width counts, because the area is measured.

A panel with others folded into it shows their tabs on its strip. Each tab still belongs to its own
panel: picking one focuses that panel, and the host shows whichever of its group has the focus. No
tab has to be moved, so nothing needs undoing when the window grows. Dragging a tab while folded is
a real move, though, and it stays where it was dropped.

`shownPanels` records what is really on screen. The floating call and the sidebar read it instead of
working out the same thing again.

### Video needs nothing new

`adaptiveStream` already sizes each subscription to its element, and a tab or panel that isn't shown
is unmounted, which detaches its video.

## Consequences

- Dividers only respect the minimum size while dragged. A ratio saved in a big window can leave a
  panel under 320px in a smaller one that still fits the layout as a whole.
- Splitting or closing a panel remounts the panels around it, so a chat there reloads its position.
- `split` can only go when no one is on a version that reads it, like `members` in 0038.
