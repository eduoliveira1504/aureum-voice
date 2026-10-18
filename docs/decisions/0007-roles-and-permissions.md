# 0007 — Roles and permissions

- **Status:** accepted
- **Date:** 2026-10-16

## Context

Block 2.4 replaces the fixed owner / admin / member column with real roles. Each role has a color, an
icon, a rank and a set of permissions. Channels can override those per role or per member. The spec asks
for a hierarchy ("nobody edits or assigns a role equal to or above their own; the owner ignores
everything"), for a documented calculation order, and for every route and WebSocket event to check
permissions on the server. One target from the phase: "a server with custom roles restricts a channel to
one role".

## Decision

### Data model

- `roles (server_id, name, color, icon_url, position, permissions bigint, hoist, mentionable)`. Higher
  `position` ranks higher. Positions run from 1 to n with no gaps, kept that way on create, delete and
  reorder.
- **@everyone is a row whose id is the server's id**, at position 0. Everyone has it implicitly, with no
  `member_roles` row. Because it's a real row, its permissions are edited like any role's. Because the id
  is known, a channel override can target it without a lookup.
- `member_roles (server_id, user_id, role_id)` has a foreign key to `server_members`, so leaving, a kick
  or a ban removes the member's roles too.
- `channel_permission_overrides (channel_id, target_type role|member, target_id, allow, deny)`. The
  target has no foreign key, since it can be either kind. Deleting a role deletes its overrides.
- `server_bans (server_id, user_id, banned_by, reason)`. Joining with an invite checks it.
- The owner is still `servers.owner_id`. The migration gives each server its @everyone role, and turns
  former admins into an "Admin" role with ADMINISTRATOR, so nobody loses access.

### Calculation order

1. The **owner** has every permission, in every channel.
2. **Base** = @everyone's permissions OR the permissions of every role the member has.
3. **ADMINISTRATOR** in the base grants everything and skips channel overrides.
4. In a channel, overrides apply in this order, each one as "remove `deny`, then add `allow`":
   1. @everyone's override;
   2. all of the member's roles' overrides together: every role deny is removed, then every role allow
      is added, so between two roles, allow wins;
   3. the member's own override.
5. Without **VIEW_CHANNEL** the result is 0: the channel doesn't exist for that member. In a voice
   channel without **CONNECT**, SPEAK, VIDEO, STREAM and the voice moderation permissions are dropped.

Only channel-level permissions can be overridden. Server-wide ones, like KICK_MEMBERS, BAN_MEMBERS and
MANAGE_SERVER, are refused in overrides.

### Hierarchy

- A member's **rank** is their highest role's position (0 with only @everyone). The owner ranks above
  everything.
- Editing, deleting, assigning or reordering a role requires MANAGE_ROLES and a rank above that role.
  A reorder can't move anything at or above the user's rank, and can't move anything up to it.
- Kicking or banning requires the permission and a rank above the target. The owner can't be removed.
- **Nobody grants a permission they don't have.** This covers role permissions and override bits, in
  both directions: denying something you don't have also counts as managing it. ADMINISTRATOR lifts
  this rule.
- An override's target must also rank below whoever edits it. @everyone counts as rank 0.

### Enforcement

`app/permissions.py` keeps the calculation as pure functions over plain data, so it is unit-tested
without a database. Loaders build a `ServerAccess` per request. All of the following go through it:

- **REST**: server settings, images, channels, invites, roles, overrides, kicks, bans, message send,
  history (empty without READ_HISTORY), deletion of others' messages, and voice tokens.
- **Visibility**: a hidden channel answers 404, like a channel that doesn't exist. It's also left out of
  the server detail, its events (`channel.*`, `message.*`), @mentions, the unread feed, voice state and
  screen thumbnails. Thumbnails are now filtered per watching user.
- **WebSocket**: joining a room requires CONNECT. The reported mic, camera and screen flags are capped by
  SPEAK, VIDEO and STREAM.
- **Media**: the LiveKit token lists `canPublishSources` from SPEAK, VIDEO and STREAM, so the media
  server enforces it too. The client reads the same list to disable buttons.

Any change to roles, member roles or overrides publishes `server.permissions.updated`. Clients then
refetch the server, since which channels they see may have changed. One coarse event is simpler and
safer than patching per-user views. Anyone left in a room they can no longer join is removed from its
voice state.

The desktop app mirrors the calculation in `lib/permissions.ts`, but only to decide what the UI offers.

## Consequences

- Permission checks cost a few small queries per request: roles, member roles and overrides of one
  server. That's fine at this scale (~10 people), and easy to cache in Redis if it ever matters.
- Losing CONNECT removes the member from voice state at once, but the LiveKit connection itself stays
  until their app leaves the room, which it does when it refetches the server. A modified client could
  stay connected until its token expires. Forcing a disconnect needs LiveKit's server API, which comes
  with voice moderation.
- Some permissions are defined but **reserved** until their feature exists:
  - ATTACH_FILES (attachments);
  - ADD_REACTIONS (reactions);
  - MENTION_EVERYONE (role mentions, which `mentionable` is also for);
  - MANAGE_ADDONS (block 2.8).

  Nicknames and voice moderation came later, in block 2.R
  ([ADR 0009](0009-call-audio-moderation-and-menus.md)).

  The settings screens label them as such.
- Permissions are a 24-bit field, safe as a JSON number. Adding more later only appends bits.
