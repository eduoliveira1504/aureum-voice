# 0014 — Kanban addon and addon system lines

- **Status:** accepted
- **Date:** 2026-10-18

## Context

Block 2.8, part 2: a Kanban board with columns and cards (title, description, assignee, labels, due
date). Cards are dragged between columns, changes show up live, there is a change history, and the
server overview gets a progress card.

Two extra requirements shape it:

- The board may become a product of its own. It can't depend on servers or channels beyond a generic
  `workspace_id`.
- When someone moves a card, a system line should show up in a chat. Addon channels have no chat,
  so the line has to go somewhere else.

The example "notes" addon from part 1 has done its job and is removed.

## Decision

**The board is just another addon package**
- `apps/api/app/addons/kanban/` has four tables, all keyed by `workspace_id` with no foreign key to
  channels:
  - `addon_kanban_columns`: name, position and `stage` (todo / doing / done), which the progress
    card counts by;
  - `addon_kanban_cards`: label ids are a uuid array;
  - `addon_kanban_labels`: the color is the *name* of a token (`--label-red`...), never a raw color;
  - `addon_kanban_events`: the history. It copies titles and column names into `data`, so entries
    still read well after the card or column is gone. Because of that, `card_id` has no foreign key.
- The only foreign keys point to `users` (assignee, author, actor), which a standalone board would
  have too.
- It reaches the host only through `AddonChannel`:
  - `require` / `can` for permissions;
  - `member_ids()` for who may be assigned;
  - `publish` for live events;
  - `announce` for system lines.
- A new board starts with "A fazer / Fazendo / Feito".
- Changes that touch positions take a per-board advisory lock (`pg_advisory_xact_lock`) and renumber
  positions to `0..n-1`. That keeps ordering exact without fractional positions, and boards are
  small.
- Permissions: `view` = VIEW_CHANNEL; `edit` (cards) = SEND_MESSAGES; `manage` (columns, labels) =
  MANAGE_ADDONS.
- Limits per board: 20 columns, 30 labels, 2000 cards, 10 labels per card.
- A column can be deleted only when it's empty, and a board keeps at least one column. Nothing is
  thrown away by accident.
- Events: `addon.kanban.card.created|updated|deleted`, `cards.moved` (the new positions of every
  card touched), `column.*`, `columns.moved` and `label.*`.

**System lines are a framework feature, not a Kanban one**
- Addon channels get an optional `announce_channel_id`, a text channel of the same server, picked in
  the channel's "Addon" settings tab. It is off by default.
- Messages get a `system` jsonb: `{addon_key, source_channel_id, group, lines[], last_at}`, with an
  empty content. The author is the person who acted, so the line reads "Ana moveu “Login” para Feito".
  These lines can't be edited, and they can be deleted like any message.
- Addons call `ctx.announce(text, group=...)`. Only addons whose manifest sets `announces=True` can
  have an announce channel.
- If the same person acts in the same addon channel and group less than 2 minutes after their last
  line, the new text is appended to that line (up to 20) instead of starting a new message.
- The board announces moves between columns only. Reordering within a column isn't news.
- Lines go to the people who can see the announce channel. Failing to post one never undoes the
  change: it is logged.
- **Audience check:** picking an announce channel that people who can't see the addon channel can see
  would leak card titles to them. The API answers 409 `wider_audience` (with the count) until the
  request carries `confirm_wider_audience: true`. The app then shows "Pessoas sem acesso ao quadro vão
  ver os títulos dos cards nesse canal" and asks to confirm. The check runs when the channel is
  picked. If permissions change later, the channel stays as chosen.
- Deleting the announce channel turns the lines off (`ON DELETE SET NULL`).

**Removing the notes addon**
- Its Alembic branch was downgraded (`alembic downgrade notes@base`) on the existing databases
  *before* its files were deleted. Otherwise `upgrade heads` fails on an unknown revision. Any other
  database that ran part 1 needs the same step, run from that commit.

## Consequences

- To run outside Aureum, a standalone board would only need its own implementation of
  `AddonChannel`: permissions, members, events and `announce`.
- Any future addon (watch together, for instance) can post system lines without new core code.
- The overview card reads the same board state as the panel, so it updates live with no extra route.
