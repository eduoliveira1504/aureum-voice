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

### Panels are siblings, in the order of their ids

The tree is not the page's structure. Panels used to be nested in one element per division, and a
React key only keeps a component among siblings, so dividing a panel moved it to a new parent and
rebuilt it: the chat lost its scroll, and calls, shares and whiteboards started over. Now every
panel is a child of one area, with a box computed from the tree (`placePanels`), so a change in the
tree is only a change of position and size.

Each panel has an `id`, saved in the layout, which is its key. An index wouldn't do, since closing a
panel shifts the ones after it. Layouts from before ids, and panels saved by an older app (which
drops the field), get one from their place on read, the same on every read until it's saved.

Keys alone still let React move nodes when the order changes, and taking a video out of the page
restarts it. So panels are kept in the order of their ids, not of the tree: rearranging them, even
from another device, moves no node. Tab order follows the ids too, not the positions on screen.

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

### Minimum size on every size

The window and the member bar can change the room after a ratio was saved, so the ratios on screen
go through `fitRatios` whenever the area is measured: on opening, on resizing and when the bar
changes. Each side gets at least what its panels need, and what's left of the saved ratio. Only what
doesn't fit even then is folded. Nothing is written back, so the saved ratios return when there's
room for them.

A divider's place on screen isn't its place in the saved tree when panels are folded. `pathBetween`
finds the split in the saved tree from the panels on each side of it, so a drag saves to the right
one.

### Video needs nothing new

`adaptiveStream` already sizes each subscription to its element, and a tab or panel that isn't shown
is unmounted, which detaches its video.

## Consequences

- A panel that isn't shown is unmounted, so maximizing, folding or narrowing the window rebuilds the
  panels hidden by it when they return. That's on purpose: hidden panels must not receive video.
- With panels folded, picking one of the tabs swaps what the host shows, which is a different panel
  and so a different instance.
- While an older app rewrites the layout, its panels lose their ids and get them back from their
  place. A panel can then be rebuilt once.
- `split` can only go when no one is on a version that reads it, like `members` in 0038.
