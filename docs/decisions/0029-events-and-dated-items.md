# 0029 — Events, reminders and the dated_items hook

- **Status:** accepted
- **Date:** 2026-10-25

## Context

Block 3.9C adds events (addon key `events`, "Eventos"): meetups with a time, a place, an optional
cover and weekly repeats, with Vou / Talvez / Não vou, reminders from @aureum, a card on the server
overview and today's events in Home. Block 3.9D's calendar must then gather everything with a date
from the addons of a server (events and the Kanban board's due dates) without knowing them.

## Decision

**dated_items: addons say what has a date**
- `AddonManifest.dated_items(session, workspace_ids, start, end, user_id)` returns `DatedItem`s:
  an id (unique in the addon), the workspace, the `item_id` to open, title, `kind`, either an
  all-day `day` or `starts_at`/`ends_at`, an optional label color, `done`, `cancelled` and `mine`.
  Same pattern as the `assigned` hook ([ADR 0022](0022-home-hub.md)): the host passes only
  workspaces the user can see, and the addon never checks access.
- The Kanban board lists cards with a due date, done ones marked; `mine` is "assigned to me". Due
  dates have no zone, so the range is widened by a day and clients place them by their day.
- `GET /api/users/me/agenda?start&end[&server_id][&mine]` gathers them from every addon channel the
  user can see (one server or all), up to 62 days at a time. The app asks with its own day
  boundaries, so "today" is the user's today. Home uses it for today's events; the calendar (3.9D)
  and a future personal calendar build on it.

**Events**
- Tables (own Alembic branch `events`): `addon_events_events` and `addon_events_responses`.
- Times are stored in UTC with the IANA zone they were picked in. A weekly event repeats at the
  same wall-clock time in that zone (20:00 stays 20:00 across daylight saving), computed on the fly:
  occurrence 0 is the first, n is n weeks later. One-off events last up to 14 days, weekly ones up to
  7. Repeats have no end date; cancelling or deleting stops them.
- Answers are per occurrence, keyed by its number, so a weekly event's answers start over every
  week and an edit of the time keeps them. The app shows and answers the occurrence going on or next.
  Answers are public in the channel (lists of who said what).
- The place is a voice room of the same server, checked against the user's own access to it
  (through `AddonChannel.voice_room`, so the addon still doesn't load channels), or free text.
- Covers go to object storage (up to 5 MB), served behind the token like the whiteboard's pictures.
- Cancelling keeps the event listed as cancelled and refuses new answers; deleting removes it.
- Permission: a new bit, **MANAGE_EVENTS (1 << 25)**, "Gerenciar eventos", per role and channel.
  The addon's "manage" action is `MANAGE_EVENTS | MANAGE_ADDONS` and an action is allowed by any of
  its bits, so whoever manages addons manages events by default without a data migration. Everyone
  who sees the channel answers. Four bits (26 to 30) remain before the desktop needs BigInt.
- Creating an event posts "criou o evento “X”" to the announce channel, like the other addons.

**Reminders from @aureum**
- New official DM category `eventos` (users can turn it off in Notificações) and bot action
  `dm-eventos`, off until enabled with the CLI like the other DM actions.
- Only who said Vou or Talvez to that occurrence gets: "Falta 1 dia", "começa em 15 minutos" and
  "começou" (with the room as a channel mention). A change of time and a cancellation (or deleting an
  event still to come) are told too.
- The events addon's worker checks every 30 s. A reminder goes out within 10 minutes of its time
  or not at all (no stale reminders after downtime). Each is sent once per person through the bot's
  delivery keys; the occurrence's start is in the key, so a moved event is reminded again.
- The texts carry no clock time (the API doesn't know the user's zone). The DM's `official.event`
  carries the event, its channel and room and the occurrence's start, and the app shows the time in
  the user's zone with "Entrar na sala" and "Ver evento".
- Addons reach the bot only through `app.addons.base.event_notice`, which also fills in where the
  event lives.

**Desktop**
- The events channel lists coming up and past events; managers create, edit, cancel and delete.
  `openItem` is an event id, or `new` / `new:YYYY-MM-DD` to start one (the server menu's "Criar
  evento" and, in 3.9D, the calendar).
- The overview card shows the next three events; Home's "Pra você ver" puts today's events the user
  is going to first.

## Consequences

- The calendar (3.9D) only needs to read `dated_items`; future addons with dates show up in it by
  implementing the hook.
- Reminders depend on the worker running in the API process; with several API processes each one
  would check, but the bot's delivery keys keep every reminder single.
- Answers for occurrences far in the future can't be given yet (only the next one), which keeps
  the UI simple for a weekly game night.
