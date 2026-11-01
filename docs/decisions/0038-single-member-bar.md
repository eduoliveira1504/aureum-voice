# 0038 — One member bar per server

- **Status:** accepted
- **Date:** 2026-11-01
- **Replaces:** the "Member list per tab" part of 0016

## Context

Block 3.13: the member list was toggled per tab, from each panel's header. With two or more panels
the same list had a button in every header, and it had to work out which tab it belonged to. With up
to four panels on the way, it becomes one bar for the whole server that follows the panel in focus.

## Decision

### State lives in the panel layout

`members_open` and `members_width` join `PanelLayout`, the per-server, per-user JSON the app already
syncs, so no migration is needed. `column_sizes` couldn't hold it: its keys stop at 40 characters,
too short for a column name plus a server id.

`members_open` is null until the person chooses. While null, a layout with anything in the old
`members` list opens the bar. That field is no longer read otherwise, but the API keeps accepting
it: the previous app version still sends it. `members_width` is null until the bar is resized in
that server, and falls back to the general `column_sizes.members`, so a width set before this change
carries over.

The API has to ship before this app version: an older API would drop the new fields silently, and
the bar would forget its state.

### The filter runs in the app

The list is computed with `channelPermissions`, the client's mirror of the API's rules, over the
`server.members` and channel overrides the person already receives. A new endpoint was turned down:
changing focus would wait on the network, and it wouldn't protect anything. The server's member
list is visible to every member anyway, and the API never sends a channel, or its overrides, to
someone who can't see it, so nobody can work out who is in a channel hidden from them. Changes to
permissions arrive as `server.permissions.updated`, which refetches the server.

Any channel that hides someone filters the list, not only channels hidden from `@everyone`. The
title names the channel only in that case. The call tab counts as the room of the call.

### Where it lives

There is no server header on the right: the server name sits at the top of the sidebar. The button
goes on the right of the top bar, before the search, and only shows inside a server. A new strip
just for this button would take height from every panel.

### Shortcut: Ctrl+Shift+U

It's free in the app, in the whiteboard (Excalidraw) and among the default overlay shortcuts.
Ctrl+Shift+M reads better in Portuguese, but it's mute in Discord and Teams, which is the wrong thing
to teach someone in a call. Ctrl+U is Discord's own shortcut for this. Ctrl+Shift+L is taken by
Excalidraw, and Ctrl+Alt+letter collides with AltGr on ABNT2 keyboards. It works while typing, and
stays out of the way of open modals.

### Narrow windows

Below the layout's ~1100px limit the bar is a drawer whose state is never saved and which always
starts closed. Reusing the saved state would make narrowing the window cover the content on its own.
Widening the window closes the drawer and restores the saved state. Esc and clicks on a menu or card
opened from the drawer belong to that menu or card, not to the drawer.

## Consequences

- The overview now shows the bar too, next to its own members block, if the person leaves it open.
- `members` can only be removed from the API once no one is on a version that sends it.
