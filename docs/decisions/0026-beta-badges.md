# 0026 — Pioneiro limit and the Beta Tester badge

- **Status:** accepted
- **Date:** 2026-10-25
- **Phase 3, block 3.8**

## Context

Pioneiro (0018) went to every account that confirmed its e-mail during the beta. The idea is for it
to mark the very first people, so it needs a cap. Everyone else who tests the beta still deserves a
badge of their own.

## Decision

**Pioneiro stops at `AUREUM_PIONEER_LIMIT` (20).** The limit caps the numbers, not a count:
- a new number comes from `pioneer_number_seq`, and once `nextval` passes the limit nobody else gets
  the badge, even with `AUREUM_BETA=true`. The sequence never hands out a value twice, so two people
  confirming at once can't both get #20; one gets the badge, the other doesn't;
- reserving a number above the limit is refused (CLI `--pioneiro N`). Reserved numbers count, because
  they use up numbers within the limit, and they're still handed out to whoever they were kept for;
- numbers already handed out never change.

A rolled-back confirmation burns its number (as before), so in a rare case fewer than 20 people end
up holding it. That's accepted to keep the numbering lock-free.

**Beta Tester.** `beta_tester` is legendary, not numbered and beta-only (`exclusive_beta`). Its
placeholder art is a lab flask, in the same SVG style as the others. It's granted together with
Pioneiro when the e-mail is confirmed while `AUREUM_BETA=true`, and Pioneiros get both. Official
accounts get neither. Each badge granted sends its official DM in the "insignias" category once
(key `badge:<key>`). Accounts confirmed before the badge existed get it with
`python -m app.cli badges grant-all beta_tester`. The command says how many accounts it will reach
and asks before granting. It covers confirmed, non-official accounts. The unconfirmed ones get the
badge when they confirm.

**Descriptions** (tooltip and profile card) come from `app/badges.py`, which also lists the
planned badges' wording.

## Consequences

- No migration: the catalog is synced to the `badges` table at startup. The API needs a restart in
  production, and older apps show the new badge with no changes (they read the catalog).
- In production the retroactive grant is a manual CLI step, shown to the owner and run with his OK.
- The landing page, README and invite flow no longer promise Pioneiro to everyone. The invite page
  only shows the Pioneiro card when a number came with the confirmation.
