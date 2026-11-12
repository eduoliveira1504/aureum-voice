# 0049 — Deactivating and deleting an account

- **Status:** accepted
- **Date:** 2026-11-12

## Context

Block 4.2.2: people need to be able to step away (deactivate) or leave for good (delete), and the
admin needs to clean up fake sign-ups. The schema was already shaped for deletion: almost every
table that points to `users` cascades, messages, attachments and the Pioneer number go `SET NULL`,
and `servers.owner_id` is `RESTRICT`. Nothing let an owner hand a server over, which deletion needs.

## Decision

**States.** `users.deactivated_at`, `users.deletion_due_at` and `users.delete_messages` (migration
`d1f7b3c5e598`, with a downgrade). Active → deactivated → deletion scheduled (deactivated, with a
date) → deleted (the row is gone).

**Deactivate** (`POST /users/me/deactivate`, password). Bumps `session_epoch`, which ends every
session and WebSocket, and sends `friend.removed` to friends and pending requests. While
deactivated:
- the account leaves friend lists (`social.friend_ids` skips it), so nobody can open a DM, group
  or call with it, and a friend request to its @ answers like an unknown user;
- `UserPublic.deactivated` is true and others see only name and avatar; the app shows a small
  "Conta desativada" card instead of the profile;
- server memberships and messages stay, so everything comes back.

Signing in with e-mail and password reactivates it at once (`friend.updated` to the other side).

**Delete** (`POST /users/me/deletion/code` with the password, then `POST /users/me/deletion` with
password, the 6-digit code (`delete_account`, the 2.10 flow) and `delete_messages`). Owners of a
server get 409 `owns_servers` with the list; `POST /servers/{id}/transfer` (owner only, to an
active member who isn't a bot) lets them hand it over. Scheduling deactivates the account, sets the
date 30 days ahead and e-mails a notice. Signing in during those 30 days returns tokens, but every
route except `GET /users/me` and `DELETE /users/me/deletion` answers 403 "Account deletion
scheduled"; the app shows only "Cancelar exclusão" or sign out.

**Finishing** (`app/account_deletion.py`). A worker in the API process (like the other workers)
checks hourly and finishes the due deletions, skipping anyone who still owns a server:

| Data | Requested deletion | Purge (fake account) |
|---|---|---|
| Account, profile, settings | deleted | deleted |
| Avatar and banner files (MinIO) | deleted | deleted |
| Friendships, requests, blocks | deleted (cascade) | deleted |
| Sessions and tokens | gone with the row | gone |
| Server and account invites they created | deleted (cascade) | deleted |
| Badges, votes, reactions, DM and group memberships | deleted (cascade) | deleted |
| Uploads never sent in a message | deleted with their files | deleted |
| Messages and their attachments | kept as "Usuário excluído", or deleted with their files when asked | none exist |
| Pioneer number | stays taken, never reused | same |
| Kanban cards, polls, events, boards, stickers, sounds they made | stay (the server's), no author | same |
| E-mail | free at once | free at once |
| @ | held 90 days, stored only as an HMAC (`released_usernames`) | same |

A forwarded copy of their message is someone else's message and stays. A notice e-mail goes out when
the deletion is done.

**Purge** (`python -m app.cli accounts purge [--dias N] [--dry-run]`). Candidates never confirmed
their e-mail, are in no server, never sent a message, are older than N days (30) and aren't
official or bot accounts. `--dry-run` only lists; without it the command lists and deletes only
after typing `apagar <count>`, checking the rules again at that moment. It uses the same `finalize`,
with no grace period and no e-mail (the address was never confirmed).

**Where in the app.** Editar perfil › Conta, under e-mail and password: the account settings moved
out of Configurações in an earlier block, and a second "Conta" would split them.

## Consequences

- E-mail is free right away, so someone can come back with a new account; the @ isn't, so nobody
  can take it to pass for the person with their old friends.
- Holding the @ uses an HMAC keyed by `JWT_SECRET`: rotating that secret releases the held names
  early (acceptable).
- Deleting many messages sends no `message.deleted` events; open chats show them until reloaded.
