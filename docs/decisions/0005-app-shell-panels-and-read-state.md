# 0005 — App shell, panels and read state

- **Status:** accepted
- **Date:** 2026-10-16

## Context

Block 2.L moves the app away from the four-column layout (server rail, channel list, content,
members) to Aureum's own shell. Across the top is a tab bar, with Home first and then one tab per
open server. Below it is a sidebar for the current tab, and content opens in up to two panels side
by side. The call lives in a floating window. Several parts need state that has to survive restarts
and look the same on every PC. The server overview also needs live room previews, and those must
not cost LiveKit Cloud bandwidth (see [0004](0004-call-layout-and-bandwidth.md)).

## Decision

### Layout state lives in `user_settings`

These columns are added to the existing table:

- `tab_order`: server ids in the order of the top bar.
- `closed_tabs`: servers taken off the bar. The user is still a member.
- `sidebar_collapsed`
- `panel_layouts`: a JSON object keyed by server id. Each value is
  `{ panels: [{ tabs, active }] (1–2), split }`.

Tabs are `overview`, `call`, `channel:<uuid>` and `addon:<key>`, and the API validates that shape.

`PATCH /users/me/settings` **merges `panel_layouts` per server**. A layout replaces that server's
entry, `null` removes it, and other servers are kept. That way, two PCs arranging different servers
don't overwrite each other. Saves go out debounced (400 ms) through the same queue as theme changes.
Other devices get them live as `settings.updated`.

Some state stays local to each window, because it depends on the screen in front of the user:

- which panel has focus;
- the floating window's corner, kept in `localStorage`;
- fullscreen;
- the narrow-window mode.

Below 1100 px the sidebar shows icons only and a single panel. This is applied on screen only;
the saved layout keeps both panels.

### Read state: `channel_reads (user_id, channel_id, last_read_message_id, mention_count)`

- **Unread** means messages with a higher id than the marker that were written by someone else.
  It's counted with a query, not stored, so it can't drift.
- **Mentions**: `@username` of a server member, parsed when the message is created. Mentions of
  oneself or of non-members don't count. Edits don't add mentions. `@everyone` waits for the
  permissions in 2.4.
- When someone **joins** a server, rows are seeded at the latest message, so the whole history
  doesn't show up as unread. The migration does the same for existing members.
- `POST /channels/{id}/read` moves the marker forward only (it is clamped to the newest message)
  and clears mentions. The `read.updated` event syncs the user's other devices. The client marks a
  channel read while it's open in a visible panel, including messages that arrive while it's open.
- `message.created` events carry `mentions` (user ids), so badges update without a refetch.
  `GET /servers/{id}/unread` returns the newest unread messages for the overview's "News" column.

### Screen thumbnails go through the API WebSocket, not LiveKit

- Only the person sharing generates them: a 320×180 JPEG at quality 0.6, every 7 s, starting about
  1.5 s after the share begins. They are sent as `screen.thumbnail`.
- The API accepts one only if that user's voice state says they are sharing right now. It must be a
  valid JPEG data URL of at most 64 KB, and the user can send at most one every 4 s.
- Only the latest thumbnail is kept, in Redis with a 20 s TTL. It is never written to Postgres or
  MinIO.
- Delivery is per connection, not per user. A client sends `overview.watch {server_id}` while that
  server's overview is on screen (`null` when it leaves), and only those connections receive the
  thumbnails. When a client starts watching, it gets the current thumbnails right away.
- When the share or the call ends, the API deletes the thumbnail and tells watchers (`image: null`).

### Floating call window

- It shows someone else's screen if there is one, otherwise whoever is speaking (it keeps the last
  speaker between sentences).
- It is about 320 px wide, so `adaptiveStream` subscribes to the lowest layer (0004) with no extra
  code.
- It hides when the call is visible in a panel or fullscreen. When minimized, it becomes a card at
  the bottom of the sidebar.

## Consequences

- An overview costs each viewer about one 10–20 KB image per sharer every 7 s, and nothing on
  LiveKit. Viewers who aren't in the call never touch the media server.
- Watching is tracked in the API process that holds the socket. Events still fan out through Redis,
  so this works with several API processes, but a client must re-send `overview.watch` after it
  reconnects. The client does this on `ready`.
- The addon entries (Quadro, Cinema) and the Home tab's friends/DMs are placeholders until blocks
  2.8 and 2.3 fill them in. The shell already has their final places.
