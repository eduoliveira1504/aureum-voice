# 0048 — Server types: Jogo, Trabalho, Misto

- **Status:** accepted
- **Date:** 2026-11-12

## Context

Block 4.2.1: a server is made for one of two audiences, friends who play together or a small work
team, and each needs a different set of addons (a soundboard has no place in a work server; a
kanban is noise in a gaming group). The type must be picked once and never change, so a server
never loses an addon that people are using.

What exists doesn't line up with "a list of addons" one to one:

- The **sound panel** (block 3.15) is not an addon in `app/addons/registry.py`: it's a server
  feature with its own routes (`/servers/{id}/sounds`, `/sounds/{id}/play`).
- **Eventos** (`events`) is an addon, and the Calendário shows its events: a type with the
  calendar but without events would have an almost empty calendar.
- **Enquetes** (`polls`) live in chats, in servers and also in DMs and groups; they're never a
  channel.

## Decision

- `servers.type` is `game`, `work` or `mixed`, stored as `VARCHAR(16)` with a check constraint
  (the `native_enum=False` pattern of `app/models.py`). The migration (`c9e5a1b3d486`, with a
  downgrade) gives existing servers `mixed`, which allows everything, so nothing disappears.
- **One list, in the API.** `app/server_types.py` maps each type to its name, a one-line
  description and a set of keys: addon keys plus server features (`soundboard`). A test checks
  every key is a real addon or feature.

  | Key | Jogo | Trabalho | Misto |
  |---|---|---|---|
  | polls | ✓ | ✓ | ✓ |
  | events | ✓ | ✓ | ✓ |
  | calendar | ✓ | ✓ | ✓ |
  | soundboard (feature) | ✓ | | ✓ |
  | kanban | | ✓ | ✓ |
  | whiteboard | | ✓ | ✓ |

  TFT joins game and mixed in block 4.2.3. Polls in DMs and groups don't depend on any type.
- **The app reads it.** `GET /api/server-types` feeds the create screen; every server sent to the
  app carries `type` and `addons` (its allowed keys). The app filters the add-addon list, the call's
  sound panel button and the settings' sound tab with `serverAllows`. Against an older API that
  sends no `addons`, it allows everything (that API has no types).
- **Locked.** `POST /servers` takes `type`, optional with `mixed` as default so older apps keep
  creating servers. `PATCH /servers/{id}` refuses any `type` with 422, even the current one.
- **Refused by the API.** Creating an addon channel outside the type: 403. Adding or playing a sound
  where the type has no soundboard: 403; listing sounds there returns an empty list (apps ask on
  every server). Creating channels and adding sounds check the managing permission before the type.

## Consequences

- A new addon must be added to the types in `app/server_types.py`, or no server can have it.
- Changing a type's list later is safe to widen; narrowing it would leave channels the type no longer
  allows, which still work (only new ones are refused).
- Older apps still show the sound panel button in work servers; the play is refused by the API. Work
  servers only exist from this version on, created by the new app.
