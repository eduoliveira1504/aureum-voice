# 0051 — Search inside a server

- **Status:** accepted
- **Date:** 2026-11-22

## Context

Block 4.2.4: people need to find old messages in a server, filtered by channel, author and date,
and jump to them. It must cost nothing (no new service) and must never show a message from a
channel the person can't read.

## Decision

**Engine.** Postgres' own full text search with the `portuguese` configuration: `to_tsvector`
over `messages.content`, matched with `websearch_to_tsquery`, which accepts anything typed (quotes,
`-palavra`, `or`) without syntax errors and stems words ("jogar" finds "joga"). A GIN expression
index, `ix_messages_content_search` (migration `f3b9d5a7c820`), backs it. The configuration is
written into the SQL as `'portuguese'::regconfig`, not sent as a parameter, so the planner matches
the index expression (checked with EXPLAIN). Meilisearch or Elasticsearch were left out: a new
service to run and keep in sync for servers this small.

**Route.** `GET /servers/{id}/search?q=&channel_id=&author_id=&since=&until=&before=&limit=`.
Newest first, paged by message id (`before`, answered as `next_before`), up to 50 a page. `q` is
required; an empty one is a 422. 30 searches a minute per person (`rl:search:*`).

**Access.** Only channels where the person has VIEW_CHANNEL and READ_HISTORY: the same rule as a
channel's own history, which is empty without READ_HISTORY. A `channel_id` the person can't read
answers an empty page, like one that doesn't exist, so private ids can't be probed. Non-members get
404. Messages are returned as `MessageOut`, the same shape as the history.

**App.** A field in the server's sidebar opens a search window with the filters (dates are whole
days in the person's time zone). A result opens its channel and reuses the "go to message" the
replies and Home already use; it now keeps loading older pages while the oldest loaded is still
newer than the message (up to 40 pages of 50), instead of stopping at 5.

## Consequences

- Accents matter: the `portuguese` configuration doesn't strip them, so "reuniao" doesn't find
  "reunião". Postgres' `unaccent` (contrib, free) would fix it with a custom configuration and a new
  index; left for later (docs/decisions/USABILIDADE.md).
- Only the text is searched: not file names, link cards, forwards' original text or addon lines.
- A result more than ~2000 messages back in its channel opens the channel without reaching it.
