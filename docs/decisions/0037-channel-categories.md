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
