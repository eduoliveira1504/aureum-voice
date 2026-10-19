# 0019 — Account e-mails, account invites and the invite page

- **Status:** accepted
- **Date:** 2026-10-21

## Context

Block 2.10 closes the beta. People only get in with an invite, confirm their e-mail with a code, and
can recover their account without asking the owner. The invite arrives as a WhatsApp link, usually
opened on a phone, so the sign-up has to work in a mobile browser before anyone installs the app.
Everything stays free: plain SMTP from a dedicated Gmail account (about 500 e-mails a day), the
existing Postgres, and the API already behind Tailscale Funnel.

## Decision

**Account invites are not server invites**
- New `account_invites` table. **Single-use** invites: every confirmed account gets 3. **Group**
  invites have spots and an expiry, and come from the CLI. With `AUREUM_INVITE_ONLY=true`, server
  invites no longer create accounts. They only bring existing accounts into a server. Without this,
  the 3-invite limit would mean nothing.
- The "first account needs no invite" exception is gone. The first account (@edu) comes from the CLI.
- **When a use counts:** at e-mail confirmation, not at sign-up. Sign-up only checks that the invite is
  valid at that moment. The pending link is `account_invite_uses.confirmed_at IS NULL`, which also
  records who invited whom. If the invite runs out between sign-up and confirmation, the confirmation
  still counts and `uses` can go over `max_uses`. Accepted trade-off: two people can sign up with the
  same single-use link before either confirms, and both get in.
- The shared link is `{PUBLIC_BASE_URL}/convite/{code}`. Codes are 8 characters from an alphabet
  without 0/O/1/I/L. Wherever a code is accepted, the whole link works too.

**E-mail**
- `app/mail`: requests only insert a row in `email_outbox`, committed together with the change that
  caused it. A worker in the API lifespan sends due rows (`FOR UPDATE SKIP LOCKED`) with backoff:
  30s, 2min, 10min, 30min. The CLI queues the same way, and the API does the sending.
- A sent row is deleted. After the 5th failure the row is kept as a record, but its `params` are
  emptied (they hold the code) and the address is masked (`ed***@gmail.com`).
- **Providers:** `smtp` (stdlib `smtplib` in a thread, no new dependency) and `memory` (tests). Adding
  Resend or Brevo later is a class plus a line in `get_provider()`.
- **Logs** show the template, the row id and the masked address, never codes, bodies or credentials.
- **Templates:** pt-BR HTML built on `docs/design/emails`, with a shared frame (`layout.html`) plus one
  body per e-mail, always with a plain-text version.
- **Images:** Gmail doesn't render SVG, so the logo and the Pioneiro badge are PNGs at 2x in
  `app/static/email`. `scripts/generate-email-images.mjs` renders them with the desktop app's Electron
  (offscreen window), reading the badge art from `app/badges.py`. The glow is the same CSS drop-shadow
  the app uses.
- **Download link:** goes in the welcome e-mail ("Baixar o Aureum"). There is no separate e-mail. It
  points to the newest `.exe` in the GitHub releases (pre-releases included, since beta builds are
  pre-releases), read from GitHub's public API without a token and cached for 10 minutes.

**Codes**
- 6 digits, 15 minutes, 5 wrong tries, a new code only after 60 seconds. Each new code replaces the
  previous one. The database stores an HMAC (`JWT_SECRET`) of the code, never the code itself.
  Rate limits per IP apply on top of the per-code limits.
- An unconfirmed account can sign in but cannot create servers (403, checked in the API).
- Accounts that existed before this block start unconfirmed.
- **Forgot password** gives the same answer whether or not the account exists. Resetting signs in and
  ends every other session.
- **E-mail change** needs the current password and a code sent to the new address. The old address
  gets a security notice, with the new address masked.

**Confirmation** (`app/onboarding.py`, one transaction)
- The invite use counts.
- The Pioneiro badge is granted while `AUREUM_BETA=true`.
- 3 invites are created.
- The account joins every official server it isn't banned from (it can leave later).
- The welcome e-mail is queued.
- Official accounts (`--oficial`) get no badge, no invites and no welcome. The exception comes only
  from the flag.

**Pioneiro numbers**
- `pioneer_numbers` is a ledger of every number ever reserved or handed out. Rows are never deleted:
  links to the account or invite become NULL instead. New numbers come from `pioneer_number_seq`.
  Each one is inserted with `ON CONFLICT DO NOTHING`, and a conflict means "reserved, try the next".
- This is safe under concurrent confirmations. A number is never reused, not even after the account
  is deleted, and `--pioneiro N` refuses a number that is already in the ledger.
- **Reserving a number:** for an account (`users create --pioneiro N`) or for whoever signs up with an
  invite (`invites create --pioneiro N`).

**Sessions**
- `users.session_epoch` goes into every token. Changing or resetting the password bumps it, so older
  access and refresh tokens stop working.
- A `session.ended` event closes older WebSocket connections in every API process. The device that
  made the change gets new tokens and reconnects.

**Temporary passwords**
- `users create` without `--password` generates one, prints it once and never logs it.
- `must_change_password` blocks every route except `GET /users/me` and `POST /auth/change-password`,
  and also the WebSocket. Logout is client-side, so it always works. The app shows a mandatory
  screen before anything else.

**The invite page**
- `/convite/{code}` is served by the API, so through the Funnel it shares the origin with `/api` and
  needs no CORS. It is plain HTML, CSS and JS, mobile first, with the code passed in a data attribute.
- **CSP:** `script-src 'self'`, no inline scripts or styles, `frame-ancestors 'none'`, `no-store`.
- **Steps:** sign-up (inviter or spots left at the top, the @ checked live), the e-mail code (resend
  countdown, spam tip, change e-mail) and Pioneiro + download. On a phone, the last step says the link
  is in the welcome e-mail.
- **Tokens:** the sign-up tokens live only in a page variable (no localStorage or sessionStorage) and
  are dropped after confirming. Reloading means confirming in the app. There is no web login.

## Consequences

- Testers get a link, sign up on their phone and install on the PC later. Nobody needs the owner to
  create or recover an account.
- `.env` gains `PUBLIC_BASE_URL` (the Funnel URL) and `AUREUM_INVITE_ONLY`. SMTP credentials stay
  only there.
- Until SMTP is configured, codes don't go out: they wait in the outbox and are retried.
- Launch (wipe the data, then create @edu, the reserved accounts, the official server and the group
  invite) is a separate step, done only with the owner's OK. Wiping must also restart
  `pioneer_number_seq` and empty `pioneer_numbers`, or the numbering won't start at 1.
