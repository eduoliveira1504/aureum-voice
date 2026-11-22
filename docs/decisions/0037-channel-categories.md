# 0037 — Channel categories

- **Status:** accepted
- **Date:** 2026-11-01

## Context

Block 3.12: free categories replace the fixed "Salas / Conversas / Addons" sections. They hold any
mix of channel types, can be private, and channels follow their permissions by default. The beta has
real users, so nothing may change on screen until someone edits a category, and a mistake here
could expose a private channel.

## Decision

### Data

`channel_categories (server_id, name, position)`, `channel_category_overrides` and two columns on
`channels`: `category_id` (`ON DELETE SET NULL`; null means no category, at the top) and
`permissions_synced`. `user_settings.collapsed_categories` keeps collapsing per person across
devices. The migration gives each server the three old sections as categories, holding today's
channels with their positions untouched. A channel that already has overrides starts out of sync.

### Permissions: a category is a template

Access keeps reading only `channel_permission_overrides`. A category's overrides are copied to the
channels with `permissions_synced`; editing a channel's own overrides turns the flag off, and
"Sincronizar com a categoria" copies them back. Resolving permissions through the category at read
time was turned down: every access check (REST, WebSocket, voice tokens, addons) would need to know
about it, and missing one would be a leak.

**Moving a channel never changes its permissions.** A private channel dragged into an open category
stays private and is simply out of sync. It only counts as synced if its overrides already match.
Deleting a category keeps its channels, without a category and with the permissions they have.

### Visibility

A category is sent to someone who sees a channel in it. Who has MANAGE_CHANNELS also gets empty ones,
to fill them in, unless the category's own overrides hide it from them. Requests for a hidden
category answer 404, so ids can't be probed.

### Realtime

Every category change, moves between categories included, publishes the existing
`server.permissions.updated`, which carries only the server id. Each client refetches the server,
filtered by the API. A private category's name therefore never goes out on the WebSocket, and no new
event is needed for clients to stay right. Refetching on each drag was accepted: drags are rare and
servers small.

### Compatibility

The new fields are additive. `PUT /servers/{id}/channels/order` stays for apps on 0.2.0-beta.8 and
earlier, which keep showing their three sections by type. A channel they create has no category, so
newer apps show it at the top until someone moves it.

## Addendum (block 4.2.8): the addons category

"Addons" had become a category like any other, so a text channel could be created in it and an
addon in "Salas". Now `channel_categories.kind` is `normal` or `addons`, with at most one `addons`
per server (a partial unique index), made with the server.

- **Rules, in the API:** addons live in the addons category and only they do. A text or voice
  channel created in it, or a channel moved between kinds (`PUT .../channels/arrange`, into it, out
  of it or to no category), gets 409 with a readable detail. It can't be renamed or deleted, and no
  normal category may be called "Addons" (any case). Its permissions and its place in the order
  stay editable. Apps show its name in their own language.
- **Older apps:** an addon created with no category or another one goes to the addons category
  without an error. `PUT .../channels/order` only changes positions, so it needs nothing.
- **Migration** (`e2a8c4f6b719`): in each server the category named "Addons" (any case, the first
  one) becomes the addons one; if it was renamed or deleted, a new one is made at the end. Text and
  voice channels in it move to "Conversas" and "Salas" (or to no category), and addons outside it
  move in. As above, moving never changes permissions: a channel counts as synced only if its
  overrides already match the new category's.
