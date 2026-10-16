# 0006 — Friends, DMs and private calls

- **Status:** accepted
- **Date:** 2026-10-16

## Context

Block 2.3 adds a social layer that doesn't depend on servers: friends, direct messages, group DMs
and calls between friends, with ringing. It has to fit the existing pieces (channels, read state,
voice state in Redis, LiveKit tokens), keep to the free tier (no push service), and leave room for
the planned features in the spec. The rule from the spec is that only friends can start a DM or a call.

## Decision

### Friendships: one row per pair, blocks one-way

`friendships (requester_id, addressee_id, status pending|accepted|blocked)`.

- A request or friendship is one row per pair, whichever way it was sent. A partial unique index on
  `(least(a, b), greatest(a, b)) WHERE status <> 'blocked'` means two crossed requests can't both be
  stored. If B asks A while A's request to B is pending, the friendship is accepted.
- A block is a row with the blocker as requester. Each person can block the other, so a pair can
  have two block rows. Blocking deletes any request or friendship between the two.
- The blocked person is never told: the blocker just disappears from their lists, and a request to
  them fails with a vague 403.
- Each side sees the same row differently (`outgoing` vs `incoming`), so `friend.updated` is built
  per recipient.

### DMs are channels without a server

They use the existing `channels` table (`server_id` NULL, type `dm` or `group_dm`), with their
members in `channel_members`. That reuses messages, pagination, read state and the chat UI as they
are. The message routes check "can see this channel" (server member or DM member) instead of
"server member".

- `channels.dm_key` (`"<smaller id>:<larger id>"`, unique) ensures a pair has only one 1:1 DM, even
  if both open it at once.
- `channel_members.hidden` lets someone close a DM from their list. A new DM starts hidden for the
  other person. It reopens (as `dm.created`) when a message or a call arrives, before the message is
  created. That way the conversation's read state doesn't already count it when `message.created`
  arrives.
- Writing in a 1:1 DM and calling require an accepted friendship. After an unfriend or a block the
  history stays readable.
- Groups have up to 10 people. Anyone in a group can write, rename it and add their own friends.
  Someone who is added gets the history, but marked as read. A group is deleted when its last member
  leaves.
- `audience_ids` (who receives a user's profile and presence changes) now covers friends and DM
  co-members as well as server co-members.

### Private calls reuse the voice flow, with a scope

Voice state in Redis now has a **scope**: `server:<id>` (its voice rooms) or `dm:<channel id>`
(the conversation's call). Tokens, `voice.update` over the WebSocket, mute/camera/screen state and
"drop out when the last connection closes" are the same code for both. The LiveKit room is the
channel id in both cases. Screen thumbnails stay server-only, since only server overviews show them.

- `calls (channel_id, started_by, started_at, ended_at)` and
  `call_participants (rung_at, joined_at, left_at, declined_at)`. A partial unique index allows one
  active call per conversation.
- `POST /channels/{id}/call` creates the call, rings the other members (`call.ringing`, except people
  blocked either way) and posts a line in the chat: a message with `call_id`. The line's unread count
  is what makes a missed call show up in the Home counter.
- Ringing lasts 30 s, timed by the clients. On the server, a missed call is computed as rung, not
  joined, not declined, and either the call ended or 30 s went by. It stays missed until the
  conversation is read. No timer process is needed.
- The call ends when the last participant leaves, through a hook voice state calls on leave. A call
  nobody joined within 60 s is ended the next time it's read: the caller's app may have failed to
  connect.
- **Adding people.** In a group they become members and are rung. A 1:1 DM can't grow, because the
  newcomer would see the pair's history. Instead a new group is created with everyone. The call
  starts there, and the people already in the old call get `call.moved` and switch over (a short
  reconnect). The old call ends when they've left it.
- The caller's app hangs up by itself if nobody can answer anymore: everyone declined or let it ring
  out, and no one ever joined.

### Presence: picked status + idle per connection

- The picked status (`online|idle|dnd|invisible`) is saved in `user_settings.status`, so it follows
  the user to every PC. It's mirrored in Redis for fast reads.
- **Auto-idle:** each connection reports whether its PC has had no keyboard or mouse input for
  10 minutes. Electron's `powerMonitor.getSystemIdleTime` covers the whole PC, so playing a game
  doesn't count as away. The user shows as idle once *all* their connections are idle.
- The visible status is `offline` when there are no live connections or the user is invisible.
  Otherwise it's `dnd`, `idle` or `online`. `presence.updated` goes out only when that visible value
  changes (deduplicated in Redis), and keeps the old `online` boolean for older clients.
- Do not disturb is enforced on the client: the popup still shows, but without the ringtone.

### Ringtone

A short three-note chime synthesized with Web Audio. There's no audio file, so there's no license
to record. Block 2.6 replaces it with the app's full sound set.

## Consequences

- No new infrastructure: everything runs on Postgres, Redis and the existing WebSocket. A user who is
  offline when called simply has a missed call.
- Ring timeouts depend on the clients' clocks, give or take a few seconds. The missed-call rule only
  needs the server's clock.
- Moving a call into a new group means a fresh LiveKit room, so there's a brief gap. It's rare (a
  third person joining a 1:1 call) and keeps DMs private.
- "Active now" shows friends in calls the user could join (rooms of shared servers, and their own
  DMs/groups). Game activity comes with profiles in block 2.5.
