# 0028 — Polls and add-ons that live in chats

- **Status:** accepted
- **Date:** 2026-10-25

## Context

Block 3.9B adds polls (addon key `polls`, "Enquetes"). Unlike the Kanban board and the whiteboard,
a poll doesn't run in an addon channel: it's created from the "+" of the message box in any server
text channel, DM or group, and shows as a message in that chat. The add-on framework
([ADR 0013](0013-addon-framework.md)) only knew add-ons that own a channel, and polls also need:

- a way for a message to carry something that isn't text, without breaking apps that don't know it;
- access rules of a chat (send messages, DM friendship), not of an addon channel;
- something that closes a poll when its deadline passes, with nobody making a request.

## Decision

**Messages can carry an add-on's thing**
- New core column `messages.embed` (jsonb): `{"addon_key", "id"}`. Its `content` is a fallback
  ("📊 Enquete: …") that older apps, notifications and previews show as plain text. Apps that know the
  add-on show its own view instead. A message with an embed can't be edited as text (400); deleting it
  goes through the usual message route (author, or MANAGE_MESSAGES in servers).
- Posting a message moved to `app/messages.py` (`post_message`, plus `chat_channel` and
  `require_dm_friends`), shared by the message route and add-ons. It takes an `on_saved` hook that
  runs once the message has its id, before the commit, so an add-on's row and its message are saved
  together.

**Chat add-ons in the framework**
- `AddonManifest.in_channel = False` marks an add-on that lives in chats. It's left out of
  `GET /api/addons` and can't be created as a channel (422).
- Its routes call `addon_chat(session, manifest, channel_id, user_id)`, the chat counterpart of
  `addon_channel`: 404 for chats the user isn't in or can't see, 400 for channels that hold no
  messages. The `AddonChat` it returns has `require_send()` (SEND_MESSAGES in a server, friendship in
  a 1:1 DM, never the official DM), `can_moderate` (MANAGE_MESSAGES; nobody in DMs), `publish()` to the
  chat's audience (or only some of them), `post()` for the add-on's message and `system_line()` for a
  line that stands on its own (`system.standalone`, with the `message_id` it's about).
- Add-ons may declare a `worker`, started with the API like the mail and bot workers.
- The desktop has a second registry for chat add-ons (`ChatAddonModule`): an `Embed` for its
  messages, an optional entry in the "+" menu and its events.

**Polls**
- Tables (own Alembic branch `polls`): `addon_polls_polls`, `addon_polls_options` and
  `addon_polls_votes`. The poll keeps the chat as `workspace_id` with no foreign key, like every
  add-on, but its `message_id` does reference `messages` with ON DELETE CASCADE: the message is the
  poll's host, so deleting it, its channel or its server removes the poll without a cleanup hook.
- 2 to 10 different options (text up to 80, optional emoji), question up to 300, single or multiple
  choice, deadline of 1 h, 8 h, 24 h, 3 days, 1 week or none, anonymous or visible votes. Anonymity
  can't change after creation.
- A vote replaces the person's previous one (an empty list takes it back) while the poll is open.
  Votes on one poll are serialized with a row lock. Percentages are of the people who voted, so in a
  multiple-choice poll they can add up to more than 100%.
- Anonymous polls never return voter ids, to anyone (the creator and moderators included). Live
  counts go to the whole chat without anyone's own votes; each voter's choice goes only to their own
  connections (`addon.polls.voted`).
- Closing: by the creator or by MANAGE_MESSAGES before the deadline; at the deadline a worker
  (every 20 s) closes it. A poll counts as closed as soon as its deadline passes, even before the worker
  runs, so late votes are refused. Closing is claimed with a conditional update, so the result line
  ("Enquete “X” encerrada: Pizza venceu", a tie, or "sem votos") is posted once.

## Consequences

- Older apps show a poll as its fallback text and can't vote; the result line reads with the
  creator's name before it. Nothing breaks, so the API can go out before the app.
- Other chat add-ons (stickers with actions, quick events) can reuse `AddonChat` and `embed`.
- A chat add-on's data is tied to its message by a foreign key: that's the one exception to "no
  foreign keys to the host", and it only points at the core's messages.
