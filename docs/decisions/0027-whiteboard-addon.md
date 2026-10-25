# 0027 — Whiteboard addon, addon permission bits and live addon sockets

- **Status:** accepted
- **Date:** 2026-10-25

## Context

Block 3.9A adds a whiteboard (addon key `whiteboard`, "Quadro branco"): several boards per channel,
drawn together live with cursors and "follow", autosave, images, versions to restore, export.
It is the first addon that needs:

- a permission of its own ("Editar quadro"), adjustable per role and channel, instead of borrowing
  a message permission like the Kanban board does;
- messages from the client many times a second (strokes as they're drawn, cursors) that aren't
  worth an HTTP request or a database row;
- events only for whoever has one board open, not for everyone who can see the channel.

## Decision

**Excalidraw (MIT) draws the boards**
- `@excalidraw/excalidraw` 0.18.1 on the desktop, loaded on demand (its ~1.7 MB chunk only loads
  when a board opens). Approved by Eduardo, who asked for its theme to follow the app's tokens and
  for its license to appear in Configurações › Sobre (added, with the other projects' credits).
- No AI: `aiEnabled={false}`, no text-to-diagram or magic frame. No embeds (they load other sites)
  and no online library (its button is hidden). The API also refuses `embeddable`, `iframe` and
  `magicframe` elements.
- Its fonts ship with the app: a Vite plugin serves them in dev and copies them into the build
  (`excalidraw/fonts/`), and `window.EXCALIDRAW_ASSET_PATH` points there. Excalidraw always adds its
  CDN as a fallback; the CSP (`default-src 'self'`) blocks it. Xiaolai (13 MB of Chinese
  handwriting) stays out, so CJK text uses system fonts.
- Theming: its CSS variables are mapped to the app's tokens (`whiteboard.css`). The canvas stays
  transparent over `bg-main`, because in the dark theme Excalidraw inverts the canvas itself.
  Thumbnails and previews are drawn as in the light theme and inverted the same way in the dark one.
- Known limit: in the packaged app (file://) `fetch()` can't read the bundled fonts, so an exported
  SVG links the fonts instead of embedding them. PNG export and the board itself are not affected.

**Addon permissions get bits of their own**
- `Perm.EDIT_WHITEBOARD = 1 << 24`, a channel permission that @everyone has by default. A core data
  migration gives it to @everyone in existing servers. The roles screen moves Gerenciar addons into a
  new "Addons" section with it; a channel's overrides show the permissions its addon declares
  (`AddonModule.permissions`), under "Addons".
- Bit budget: permissions are stored as BIGINT (63 usable bits), but the desktop app does 32-bit
  bitwise math, so new bits stay at or below `1 << 30`. With EDIT_WHITEBOARD (24) and the planned
  MANAGE_EVENTS (25, block 3.9C), bits 26 to 30 are what's left before the desktop needs BigInt.
  The role schema's cap follows `ALL` instead of a fixed 24 bits.
- Older apps keep bits they don't know when they save a role (they toggle bits on the value they
  got), so the new bit survives edits from the previous release.

**Boards and scene sync**
- Tables (own Alembic branch): `addon_whiteboard_boards` (the scene as `{element id: element}` jsonb,
  background, a `version` counter, size, thumbnail key, archived), `addon_whiteboard_snapshots` and
  `addon_whiteboard_files`, all keyed by `workspace_id`.
- Saves send only the elements that changed. Each is merged with Excalidraw's own rule (higher
  `version` wins, then lower `versionNonce`), the same one the app uses, so two people drawing at once
  keep each other's strokes and everyone converges. Deleted elements stay as tombstones, so an old
  copy can't bring them back. The scene is capped at 5 MB.
- Images: uploaded once under Excalidraw's file id (a hash of the content), up to 10 MB, stored in
  object storage and served behind the token; scenes only carry the id. They belong to the channel,
  so a duplicated board shares them. Cleanup hooks may now return storage keys, deleted by the core
  after the channel or server deletion commits, like attachments.
- Versions: the next edit after 10 minutes without one keeps the board as it was before that
  stretch of editing; the last 50 stay. Restoring keeps the current board as a version first (so it
  can be undone) and gives every element a version above the apps' copies, so open apps take it.
- The app saves about a second after a change (at most every 4 s while drawing nonstop), on leaving
  and after reconnecting, and renders a small WebP thumbnail at most every 30 s after a save.

**Addon sockets and rooms (framework)**
- Client messages `addon.<key>.<name>` go to the manifest's `socket` handlers with an `AddonSocket`:
  per-connection state, `join(rooms)` and `relay(room, event, data, user_ids)`. `on_socket_close`
  lets an addon react to a closed connection. Rooms are broker "topics": the server-overview watchers
  were generalized from server ids to any id.
- `AddonChannel.publish_room` sends HTTP-side events (a save) only to connections in the room.
- Relays skip the connection that sent them (a per-connection id that works across API processes).
- The whiteboard uses this for what isn't saved: `live` (strokes while drawn), `pointer` (cursor,
  selection and viewport, used to follow someone), `peer.joined` / `peer.left`. Access is checked when
  a board is joined and again every 15 s; viewers without EDIT_WHITEBOARD can point but their strokes
  aren't relayed. Saves still go through HTTP, which checks permissions every time.

**System line and overview**
- Creating a board posts "criou o quadro “X”" to the announce channel, if one is picked. Renaming,
  drawing and duplicating stay quiet.
- The server overview shows the board edited last with its picture and "editado por X há Y".

## Consequences

- Future addons (events, polls) get their own permission bits the same way, within the 5 left.
- Live cursors cost no database work; the relay trusts a join for at most 15 s after access changes.
- The installer grows with Excalidraw and its Mermaid chunks (loaded only when used).
