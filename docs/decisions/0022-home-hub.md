# 0022 — Home hub (Início)

- **Status:** accepted
- **Date:** 2026-10-21
- **Phase 3, block 3.4**

## Context

Home used to open on the friends list. The beta asked for a starting point with what matters now:
rooms with people in them, what the user missed, their tasks, active friends and their servers. Most of
that is already in the app's memory, loaded at sign-in and kept live by WebSocket events: every
server's visible channels, members and voice states, DMs and their calls, friends, missed calls,
activity and read counters. The server overview is built the same way.

## Decision

**Two sources, no overlap.**
- *From the stores already loaded:* "Ao vivo agora", "Amigos ativos", "Seus servidores", the read
  counters, friend requests and missed calls. They update through the events that already exist
  (`voice.state`, `call.*`, `presence.updated`, `activity.updated`, `friend.*`, `read.updated`, ...).
  The data is already filtered by permission: `ServerDetail` holds only the channels the user can see
  and only those rooms' voice states, and `voice.state` reaches only the people who can see the room
  (a test pins this). On top of that, the hub checks CONNECT with the app's permission mirror before
  offering a room.
- *From `GET /api/users/me/home`, one request when the hub opens:* what isn't in memory. That covers
  unread mentions and unread DMs with a message preview, the user's addon tasks, and each server's
  newest message in a visible channel. While the hub is open, `message.*`, `read.updated` and addon
  events keep it fresh. There is no polling: tasks are refetched once after a burst of addon events.
  `POST /users/me/home/read` ("Marcar tudo como lido") marks only what the section shows.

**Mentions match the counters.** The list uses the same parser as `reads.record_mentions`: a whole
`@username`, case-insensitive, by someone else, after the read marker, in a channel with READ_HISTORY.
`@everyone` and role mentions don't count toward `mention_count` today, so they're left out too.

**Addon tasks without coupling.** `AddonManifest.assigned(session, workspace_ids, user_id)` returns
generic `AssignedItem`s (title, status, labels, due date). The host lists the addon channels the user
can see in every server and passes only those workspaces to the addon. It then adds the
"servidor › quadro" path and sorts the items: overdue and soonest first, undated last. The Kanban
filters by assignee and by columns that aren't `done`. It still knows nothing about servers or
permissions.

**Opening things where they are.** A mention or DM opens its conversation at the message: the chat
store holds a message to focus, and the chat loads up to 5 older pages, scrolls there and flashes the
message. A task opens its board on the card through `AddonViewProps.openItem`. The shell hands the
request over, so the addon still never reads the shell's stores.

**Thumbnails.** A connection now watches servers from two places: the overview on screen
(`overview.watch`) and the hub (`home.watch`, up to 6 servers, only those of the visible cards with
someone streaming, and an empty list when the hub closes). Each thumbnail is delivered once, and the
current ones are re-sent on every watch.

**Small additions.** `VoiceState.joined_at` gives "2 pessoas · 41 min". `user_settings.news_dismissed`
keeps the "Novidades" card dismissed on every PC until the next version. The repo's `CHANGELOG.md`
is built into the app, so the notes match the installed version without any request.

## Consequences

- API changes are additive: one nullable column (`news_dismissed`) and three new routes, plus a new
  field and a new WebSocket message that older apps ignore. The beta.3 app keeps working. The column
  needs the usual production steps (`pg_dump` first).
- The hub costs one request when it opens and nothing while it's idle. Thumbnails flow only for
  streaming cards on screen.
- A future addon with assignable items implements `assigned` and appears in "Minhas tarefas" with no
  change to the hub.
