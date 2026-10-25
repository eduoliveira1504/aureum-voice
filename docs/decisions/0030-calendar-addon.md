# 0030 — Calendar addon

- **Status:** accepted
- **Date:** 2026-10-25

## Context

Block 3.9D adds a calendar (addon key `calendar`, "Calendário") to a server: month, week and list
views of everything with a date in the server's addons, events ([ADR 0029](0029-events-and-dated-items.md))
and Kanban due dates today, others later. It must respect each item's own channel permissions and
must not copy anything from the addons it shows.

## Decision

- The calendar keeps nothing: no tables, no migrations, no cleanup hook. Its one route,
  `GET /api/addons/calendar/channels/{id}/items?start&end` (up to 62 days), asks the framework for
  the server's agenda (`AddonChannel.agenda`), which runs every addon's `dated_items` over the addon
  channels of the same server the user can see. An item of a channel the user can't see never
  reaches them, through the calendar or `GET /users/me/agenda`.
- It also returns the sources (those channels), so filters list a channel even when it has nothing
  in the range. The agenda's models (`AgendaItem`, `AgendaSource`) live in the framework, since a
  calendar addon uses them too.
- Filters, "Só meus" and colors are applied in the app: one label color per source channel, in
  the sources' order; overdue cards (not done, due before today) in the danger color; cancelled and
  done items struck out.
- Picking an item opens it in its addon through the shell's `openAddonItem` (the card in the Kanban
  board, the event in the events channel). An empty day offers "Criar evento", which opens the first
  events channel where the user can create events with that day filled in (`new:YYYY-MM-DD`).
- Live updates: addons can follow other addons' events (`AddonModule.onOtherEvent`). The calendar
  reloads its range shortly after a Kanban card or an event changes (debounced), and after
  reconnecting; it stops when it's off screen.
- Weeks start on Sunday, as on Brazilian calendars. The month view always shows six weeks.

## Consequences

- A new addon with dates shows up in calendars (and Home's agenda) by implementing `dated_items`;
  the calendar's code doesn't change.
- Each calendar read runs the hooks of every dated addon of the server; fine at beta sizes, and the
  range cap bounds it.
