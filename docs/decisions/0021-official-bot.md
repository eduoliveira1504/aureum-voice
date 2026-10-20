# 0021 — The official bot, @aureum

- **Status:** accepted
- **Date:** 2026-10-20
- **Phase 3, block 3.3**

## Context

The beta needs an official voice: a welcome in the beta server, thanks when a reported bug is fixed,
and notices that reach each person (security, badges, invites, release news). The product has no AI,
so the bot runs on fixed rules and ready-made texts. The project must cost nothing, and the bot
mustn't add a process to run on the PC that hosts the plan-B stack.

## Decision

**Inside the API, reacting to events.** `app/bot` is a module, not a separate process and not a
token-based bot. Routes call it after their own commit, with ids. Each reaction runs in its own
database session and swallows its errors (they're logged). So a notice never breaks or slows the
request that caused it, and never touches that request's objects.

**The account.** It posts as the account named by `AUREUM_BOT_USERNAME` (default `aureum`). It
counts only if the account is `is_official` and `is_bot`, which only the CLI sets (`users create
--oficial`). The official look in the app comes from those flags and from `channels.is_official`, never
from message content. `messages.official` (`{"category", "badge"?}`) is a separate field, because older
apps read `messages.system` as an addon line.

**Texts in `app/bot/mensagens.toml`.** Placeholders like `{mencao}` are filled in by the API. A user is
mentioned as `@username`, the same mention the app already renders. A channel is mentioned as `<#id>`,
which the new app renders as a clickable `#name`. Messages from @aureum allow simple markdown (bold,
italic, code).

**Every action starts off.** `bot enable|disable --acao …` switches each one (`bot_actions`). Server
actions (`boas-vindas`, `bugs`, `avisos`) also need a channel (`bot set-channel`), and only a text
channel of an official server qualifies. DM actions: `dm-seguranca`, `dm-insignias`, `dm-bugs`,
`dm-convites`. Starting off matters for the order of delivery: the API can go to production before
the release, while older apps would still show `<#id>` raw.

**Official server.**
- The welcome goes once per person and server (`bot_welcomes`), even if they leave and come back. It
  carries the Pioneiro number when there is one, and points to the bugs channel when that is set.
- "Confirmar bug" (`bug_reports.confirmed_at`) posts "🔧 Bug encontrado: [título]. Já estamos
  corrigindo." and DMs the author. It's a button, not a post per report: many reports aren't bugs,
  and a report can carry logs the author didn't mean to make public.
- A resolved bug posts "✅ Bug corrigido: [título]. Valeu, @fulano! Atualizem o app e testem, por
  favor." Reports have no title, so the title is the first line of the description, cut at 60
  characters. Mark it resolved once the fix is released, or people test a version without it.
- "Fechar (não é bug)" (`bug_reports.dismissed_at`) gives no badge, posts nothing and sends no DM.

**Official DM.**
- One per user: a `dm` channel with `is_official`, created with its first message. The bot's own side
  stays closed.
- Read-only for everyone through the API. Messages, attachments and calls answer 403 with "Esta
  conversa é só de leitura. Atualize o app.", which an older app shows as is.
- Categories: `seguranca`, `insignias`, `bugs`, `convites`, `novidades`, `avisos`. The user turns
  them off in `user_settings.official_dm`. `seguranca` can't be turned off.
- `bot_deliveries` keys every notice ("badge:pioneer", "bug:<id>", "invite:<user>",
  "broadcast:<hash>"), so the same one never goes twice. A bug DM that announces the bug hunter badge
  also marks "badge:bug_hunter" as delivered.
- Security notices: password changed, e-mail changed, new sign-in. The security e-mails from 2.10
  still go out too.

**New sign-in without tracking.** The app makes a random id per install and sends it on sign-in,
refresh and sign-up. The API keeps only `sha256(user_id:id)` (`user_devices`), never the IP.
- A sign-in from an install the account hasn't seen gets a notice with the date, time and OS.
- Refreshes only record the install. The first install ever recorded for an account is never "new",
  or everyone would get a notice right after updating.
- Older apps send no id, and no notice.

**Broadcast.**
- `bot broadcast --categoria <avisos|novidades> "texto"` shows how many people will get the message
  and asks before sending (`--yes` skips the question). It then queues rows in `bot_outbox`, unique
  per user and key.
- A worker in the API sends 5 a second. It claims rows with `SKIP LOCKED` before sending.
- The key comes from the category and the text. Running the same command again counts only who still
  lacks the message, and puts back in line the rows taken but never delivered.

**Release announcements** (`app/bot/releases.py`, action `novidades`). Pulled from the backlog so
the bot needs nobody to type anything.
- A worker reads the repository's public releases on GitHub every 15 minutes, without a token. The
  public API allows 60 requests an hour per IP and this uses 4; it costs nothing.
- Only the newest release published in the last 3 days counts, so switching it on never announces
  old versions. Each tag is announced once (`bot_releases`), claimed before posting.
- It posts in the `avisos` channel and queues a `novidades` DM through the broadcast queue, with the
  release text as notes. `npm run release` fills that text from the version's section of
  CHANGELOG.md.

**Always online.** Bot accounts never open a WebSocket, so presence would show them offline.
`presence.statuses` shows `is_bot` accounts as online, always.

**Protection.**
- @aureum takes no friend requests, can't be blocked (it can be silenced), and can't join a server by
  invite. There is no user search to hide it from.
- A display name equal or close to "Aureum" is refused (`accounts.looks_official`). The check ignores
  case, accents, spaces and look-alike characters, and also refuses names containing "aureum" or one
  edit away from it. Official accounts are exempt.
- Usernames keep the 2.10 rule: only the exact reserved names are refused.

## Consequences

- Six tables and five columns, all additive: the app's previous version works against them.
- "Confirmar bug" needs the next app release; the API side and the announcements work with any app.
- The API container runs migrations on start, so deploying is migrating. The production rules apply
  (`pg_dump` first).
- The new app's side (pinned official DM, read-only footer, `<#id>` and markdown, Configurações ›
  Notificações, install id, "Fechar (não é bug)") ships in the next release. The actions get switched
  on after that.
