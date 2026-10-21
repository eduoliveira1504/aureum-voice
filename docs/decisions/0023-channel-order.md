# 0023 — Reordering channels

- **Status:** accepted
- **Date:** 2026-10-21
- **Phase 3, block 3.5**

## Context

`channels.position` already existed. A new channel took the next number and the API and the app
sorted by it, but there was no way to reorder channels. The sidebar shows three sections (rooms,
conversations, addons) out of one server-wide sequence. Private channels are hidden from some
members, and a reorder must not reveal them or move them for the people who do see them.

## Decision

**One route per section.** `PUT /api/servers/{id}/channels/order` takes `{type, channel_ids}`: every
channel of that type the user can see, in the new order. It needs MANAGE_CHANNELS on the server.
The list must hold exactly the visible channels of the section. A missing, repeated or foreign id,
or a channel of another type, is a 422.

**Hidden channels keep their slot.** The server's channels are walked in their current order. Each
slot held by a visible channel of the section gets the next channel from the new list, and every
other channel stays where it is. Then the whole server is renumbered 0..n-1 in one transaction,
under an advisory lock per server, so two people dragging can't interleave. The other sections never
move. A private channel stays between the same neighbors for the people who see it.

**Live, without leaking.** `channels.reordered` carries `{server_id, channels: [{id, position}]}` with
only the moved channels each member can see. Members with the same view share one event. The app
applies it to the server's channels and re-sorts them. The sidebar, the overview, search and the
Home hub all read that one sorted list, so the order is the same everywhere.

**In the app.**
- *Dragging:* a channel can be dragged within its section, with a line showing where it will land.
  Each section uses its own drag type (`application/x-aureum-reorder-<type>`), so the other sections
  ignore the drag. It rides on the same drag as the existing "drag into a panel".
- *Without dragging:* "Mover para cima" and "Mover para baixo" in the channel's context menu move
  it one place.
- *Saving:* the change shows at once. The API's answer then sets the final positions, and a
  refusal reloads the server.
- *Permission:* only people with MANAGE_CHANNELS get any of this, and the API checks it on its own.

## Consequences

- No migration. One new route and one new event. Older apps ignore the event and see the new
  order the next time they load the server.
- `PATCH /channels/{id}` still accepts `position` for a single channel. The app no longer uses it
  for ordering.
