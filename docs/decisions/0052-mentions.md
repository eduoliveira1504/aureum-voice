# 0052 — Mentions: people, roles, @all and @here

- **Status:** accepted
- **Date:** 2026-11-22

## Context

Found by Eduardo during 4.2: typing "@" in a chat showed nothing to pick from, and only a
hand-typed `@username` notified anyone. Roles had a `mentionable` flag and a MENTION_EVERYONE
permission, both marked "reserved". The ask: mention a person, a role, everyone in the chat and
only who is there now, with a list that pops up over the message box.

## Decision

**In the text.** `@username` for a person (as before), `<@&role id>` for a role, `@all` for everyone
who can see the channel and `@here` for those of them online. Eduardo picked `@all`/`@here`; both
are now reserved usernames (`app/accounts.py`), so they never mean a person. A role goes in by id
because names change and have spaces; the message box shows `@Nome` while typing and turns the
roles picked from the list into tokens on send (`withRoleTokens`).

**Who may.** `@all`, `@here` and roles that aren't mentionable need MENTION_EVERYONE in the
channel (the owner always has it; it isn't in @everyone's defaults). A mentionable role anyone can
mention. Without the permission the text is still sent, it just notifies no one. Only people who
can see the channel are ever notified; @everyone's own role id and roles of other servers mean
nothing. One message notifies a person once, however many ways it names them.

**Kept.** `messages.mentions` (uuid[], migration `a4c0e6b8d931`) holds who was notified, because
@here depends on who was online and can't be worked out later. Home's list of mentions reads it;
older messages (NULL) are still matched by the @names in their text. The live `message.created`
event already carried `mentions`, so sounds and badges needed no change.

**App.** `lib/mentions.ts` (parsing, matching without accents and by any word of a name, tokens)
and `MentionAutocomplete.tsx` (the list, like the `:emoji` one: ↑/↓, Enter or Tab, Esc). Server:
members who see the channel, never yourself; roles you may mention; @all/@here with the
permission. Groups: their members. Messages show a role as `@Nome` in its color and @all/@here as
a mention; previews and notifications read role tokens as `@Nome`.

## Consequences

- Apps up to 0.2.0-beta.11 show a role mention as `<@&…>` and @all/@here as plain text. They still
  notify, since the API decides.
- Editing a message doesn't notify again (as before), and the edit box shows role tokens as they are.
- Before running the migration in production, check that no account is called "all" or "here"
  (they'd lose their mentions to the special ones).
