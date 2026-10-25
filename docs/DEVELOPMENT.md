# Aureum Voice: development

Technical notes for the project: features, architecture, running it locally, tests and hosting.
For what Aureum is and how to join the beta, see the [README](../README.md).

A small, self-hosted app for a group of friends: text channels, voice channels with
camera, and **screen sharing with system audio** (the game's sound, without echoing the call back).

Built as a desktop app (Electron + React) on top of a FastAPI backend and [LiveKit](https://livekit.io)
for real-time media. The whole stack is open source and designed to run at zero cost.

## Features

- Email + password accounts (Argon2, short-lived JWT access tokens + refresh tokens kept in the OS
  keychain via Electron `safeStorage`)
- Closed beta: sign-up needs an account invite (single-use ones for every confirmed user, group ones
  with spots and an expiry from the admin CLI), shared as a link to a small mobile-first web page
  where people sign up, confirm their e-mail and download the app
- Account e-mails over plain SMTP from a background queue with retries: 6-digit confirmation codes,
  password reset by code, e-mail change, security notices and a welcome e-mail, in HTML and plain text
- Servers with an icon and an animated banner, text and voice channels, invites with expiry and use limits
- Roles with a color, an icon and 24 permissions, ranked by drag and drop: nobody manages a role or a
  member at or above their own, and per-channel overrides (allow / inherit / deny) for roles and members.
  A channel, room or add-on can be created private, open only to picked roles and members, with a lock
  in the sidebar; whoever can't see it doesn't get it anywhere (lists, history, feed, events, voice). The API checks every route and WebSocket event, and LiveKit tokens only allow what the member
  may publish. Kick and ban from the server settings
  ([ADR 0007](decisions/0007-roles-and-permissions.md))
- Per-server nicknames, and voice moderation: server mute, server deafen and moving people between
  rooms, enforced on the media server too through LiveKit's server API
  ([ADR 0009](decisions/0009-call-audio-moderation-and-menus.md))
- Right-click menus on people, channels and servers. Each shows only what the user is allowed to do:
  profile, message, call, friendship, volume, nickname, roles, moderation, kick and ban, mark as read,
  silence, settings, invite, copy ID. A person has the same menu wherever they appear: chat authors and
  @mentions, member lists, call tiles, people under rooms, DMs, group members, "Active now" and the
  profile card. Conversations in the DM list add mark as read, silence and close, and groups also add
  rename, change picture and leave
- Group DMs with a picture and a member list beside the conversation
- A collapsible member list grouped by the roles shown separately, with offline members at the end
- Real-time chat (send, edit, delete) shown as bubbles, presence and voice state over a single WebSocket
- Files in channels, DMs and groups: the "+" button, drag and drop, or paste an image. Several files per
  message, with upload progress. Images open in a full-screen viewer with zoom, videos play inline, and
  anything else is a card with a download button. Up to `MAX_ATTACHMENT_MB` (25 MB) each. Downloads
  need a token and access to the conversation, and the app caches what it already fetched (memory +
  disk, wiped on logout) ([ADR 0015](decisions/0015-attachments-and-background.md))
- Runs in the background: closing the window keeps it connected in the Windows tray (open, mute,
  deafen, status, quit). It starts with Windows hidden in the tray, only one copy runs at a time, and
  Settings > Windows changes both
- Unread counters and `@username` mention badges per channel, synced across devices
- Friends by `@username` (requests, accept / decline / cancel, unfriend, block), DMs and group DMs of up
  to 10 people, and an "Active now" list of friends in calls with a join button
- Private calls in DMs and groups: the other members get an incoming-call popup with a ringtone for
  30 s, a missed call stays in the chat and in notifications, and more people can be added mid-call
  (from a 1:1 DM the call moves to a new group, so the DM's history stays private)
  ([ADR 0006](decisions/0006-friends-dms-and-private-calls.md))
- Presence: online, idle (automatic after 10 minutes without input on the PC), do not disturb
  (silences the ringtone) and invisible
- An app shell of its own, with no system title bar: the tab bar is the top of the window (its empty
  parts move it) and Windows' buttons are drawn over it in the theme's colors:
  - a tab bar with Home and one tab per open server (drag to reorder, close and reopen);
  - a sidebar that follows the tab, with rooms, conversations and add-ons, collapsible to icons;
    people who manage channels reorder them by dragging or from the channel's menu, the same order
    for everyone ([ADR 0023](decisions/0023-channel-order.md));
  - up to two panels side by side, each with its own tabs.
  
  The layout follows the user to any PC ([ADR 0005](decisions/0005-app-shell-panels-and-read-state.md)).
  Columns resize by dragging, with sizes saved per user too. The overview tab is pinned first, and
  hovering a server tab previews its banner and who's online and in calls.
- A Home hub (Início) that the app opens on. It shows rooms and calls with people that the user can
  join, what's waiting (mentions, unread DMs, missed calls, friend requests), their Kanban tasks
  across servers, active friends, servers by activity and the installed version's notes. It loads
  with one request (`GET /api/users/me/home`), and everything else comes from data the app already
  holds, kept live by the usual events ([ADR 0022](decisions/0022-home-hub.md))
- A server overview showing who's in which room and live screen thumbnails (low-res JPEGs over the
  API WebSocket, so watching costs no media bandwidth), unread news grouped by channel, and the
  members, online first
- A call panel at the bottom of the sidebar for the whole call (who's in it, who's talking, mic, deafen,
  camera, screen, leave), people listed under each room, and an optional floating call window that
  snaps to any corner; the call expands into a panel or fullscreen
- Voice channels with camera, speaking indicator, mute / deafen, and device selection
- Each person's volume from 0 to 200% and a local mute, saved per user
- Local mic noise suppression with RNNoise (WebAssembly), free and on by default
  ([ADR 0008](decisions/0008-noise-suppression.md))
- Grid and Focus call layouts (click any tile to focus it), several live screens at once with per-stream
  volume and fullscreen; simulcast + adaptive stream keep each viewer's download to what is on screen
  ([ADR 0004](decisions/0004-call-layout-and-bandwidth.md))
- An in-game overlay with who's in the call, who's talking, who's muted and (optionally) cameras. It's a
  transparent, click-through window over games in **windowed or borderless mode** (exclusive fullscreen
  isn't supported, and nothing is injected into the game, so anti-cheats have nothing to flag). It hides
  while Aureum is focused and stays out of screenshots and screen shares. Ctrl+Shift+F9 hides or shows
  it and Ctrl+Shift+F10 enters edit mode to drag and resize it; both can be changed. They also work in
  games that block Windows hotkeys (such as League of Legends). During a call with the overlay on, the
  app reads only those shortcuts' keys, never any other key, and records nothing. Size, opacity and
  "only who's speaking" are in Settings > Overlay ([ADR 0012](decisions/0012-in-game-overlay.md))
- Screen and window sharing with a custom picker and **system audio loopback** on Windows; the call's
  own audio is excluded from the capture ([ADR 0002](decisions/0002-screen-share-system-audio.md))
- Streaming quality decided by the server: the voice token carries the user's media tier (free: camera
  and screen up to 720p, 30 fps), and the screen picker offers **Texto nítido** (15 fps, keeps
  resolution) or **Movimento** (30 fps, keeps frame rate). Simulcast still sends smaller layers to small
  tiles. Groundwork for a paid plan later ([ADR 0017](decisions/0017-media-tiers.md))
- Profiles with animated avatars and banners (PNG / JPEG / GIF / WebP, up to 8 MB), bio, profile color,
  pronouns, an avatar frame, a profile song, up to 5 links and badges. The profile card also shows
  "Now", roles in the current server and Message / Call buttons; on your own card, **Editar perfil**
  opens the editor (the same one as Settings) with a live preview and a warning for unsaved changes
- A crop editor for avatars, banners and server icons/banners (drag, zoom 1x–4x, turn 90°, live
  previews). The API crops the original with Pillow, frame by frame for animated GIF/WebP, and keeps
  it privately so **Ajustar posição** re-crops without another upload
  ([ADR 0031](decisions/0031-profile-editor-crop-and-featured-badges.md))
- Badges: hexagons whose metal shows the rarity (common, rare, legendary, mythic), with a tooltip and a
  number on numbered ones. Mythic ones glow and shine. Beta badges (Fundador, Pioneiro #N for the
  first 20, Beta Tester) are given only while the beta runs, Caçador de bugs when a reported problem
  is resolved ([ADR 0018](decisions/0018-pre-beta.md), [ADR 0026](decisions/0026-beta-badges.md)).
  Everyone sees a person's whole inventory (and how to earn the rest); each person picks up to 3 to
  show next to their name, in their order (otherwise the two rarest)
- Voice messages: hold the mic button in the message field (or click it) to record up to 5 minutes of
  Opus/WebM. The player shows the waveform, the time and 1x/1.5x/2x speed
- Push-to-talk with a key or a side mouse button that works in the background and in games, reading
  only that key and only during a call
- Automatic updates from GitHub releases, and **Reportar problema** (profile menu or Ctrl+Shift+R): a
  description, the version, the OS, recent logs with tokens removed and, only if ticked after a preview,
  a screenshot of the window. The app owner reads them in Settings
- A custom status with an emoji and an expiry, shown as a bubble next to the avatar in member lists, the
  profile card and call tiles
- Automatic "Jogando X": the app spots open games from a bundled list plus games the user adds, and sends
  only the game's name. It can be turned off, games can be hidden, and a manual activity can be set
  ([ADR 0010](decisions/0010-rich-profiles-and-game-activity.md))
- Add-ons that run in their own channels. Adding one takes the Manage add-ons permission, and each
  add-on is an isolated module in the API (its own router, tables and Alembic branch) and in the app.
  ([ADR 0013](decisions/0013-addon-framework.md)). The first one is a Kanban board: columns,
  cards with assignee, labels and due dates, drag and drop, live updates, a change history and a
  progress card on the server overview. Card moves can be announced as system lines in a chosen
  text channel, with a warning when that channel is seen by people who can't see the board
  ([ADR 0014](decisions/0014-kanban-addon.md))
- A whiteboard add-on built on Excalidraw: several boards per channel, live strokes and cursors,
  following someone, autosave with per-element merging, images, versions to restore and PNG/SVG export.
  Editing has its own permission bit ([ADR 0027](decisions/0027-whiteboard-addon.md))
- Polls in any chat (server text channel, DM or group), from the "+" of the message box: single or
  multiple choice, optional deadline, anonymous or visible votes, live counts and a result line when
  they close ([ADR 0028](decisions/0028-polls-and-chat-addons.md))
- An events add-on: time in the creator's zone, a voice room or a place, cover, weekly repeats, Vou /
  Talvez / Não vou per occurrence, reminders from @aureum (a day and 15 minutes before, and at the
  start) and its own permission. Add-ons can list what has a date (`dated_items`), gathered by
  `GET /api/users/me/agenda` for Home and calendars ([ADR 0029](decisions/0029-events-and-dated-items.md))
- A calendar add-on with month, week and list views of a server's events and Kanban due dates, each
  item only from channels the user can see, with filters per source and "only mine"
  ([ADR 0030](decisions/0030-calendar-addon.md))
- Dark and light themes (or follow Windows) and a custom accent color, saved per user on the server; text
  on and in the accent keeps WCAG AA contrast automatically ([ADR 0003](decisions/0003-design-tokens-and-themes.md))

## Architecture

```mermaid
flowchart LR
    subgraph Desktop["Desktop app (Electron + React)"]
        UI[Renderer: React, zustand, livekit-client]
        Main[Main process: secure storage, screen picker]
    end

    subgraph Stack["docker compose"]
        API[FastAPI: REST + WebSocket]
        PG[(Postgres 16)]
        RD[(Redis 7)]
        MN[(MinIO)]
    end

    LK[LiveKit SFU]

    UI -- "REST /api, WebSocket /ws" --> API
    UI -- "WebRTC: voice, camera, screen" --> LK
    API --> PG
    API -- "pub/sub, presence, voice state, rate limits" --> RD
    API -- "avatars & banners, served via /api/media" --> MN
    API -. "signs short-lived LiveKit tokens" .-> LK
```

- **API** (`apps/api`): Python 3.12, FastAPI, async SQLAlchemy 2 + Alembic, Pydantic v2. Events are
  published to Redis and fanned out to each user's WebSocket connections, so the API can scale past one
  process. Presence and voice state live in Redis with heartbeats and TTLs. Voice state is kept per
  scope: a server's rooms, or a DM/group's private call, so both use the same voice flow.
- **Add-ons**: each one is a package in `apps/api/app/addons/<key>` and a folder in
  `apps/desktop/src/renderer/src/addons/<key>`. Add-on code reaches channels only through a shared
  helper that checks permissions, so add-ons never reimplement access control. Their migrations are
  separate Alembic branches, applied with `alembic upgrade heads`. Add-on tables hang off a generic
  `workspace_id`, so an add-on like the Kanban board doesn't depend on servers or channels. Add-ons
  can also take WebSocket messages (`addon.<key>.<name>`) and send events only to the connections
  in a "room", such as the people with one whiteboard open. Some add-ons live in chats instead of a
  channel (polls): their things are messages that carry them (`messages.embed`), and they reach the
  chat through the same kind of helper (`addon_chat`).
- **Media**: the API issues a LiveKit token per voice channel (room = channel id, identity = user id) and
  returns the LiveKit URL with it, so the desktop app holds no media secrets. LiveKit can be self-hosted
  (included in compose) or LiveKit Cloud.
- **Files**: uploads are checked by magic bytes, stored in MinIO, and served through the API. MinIO is
  never exposed.
- **Desktop** (`apps/desktop`): electron-vite, React 19, TypeScript, Tailwind 4. Context isolation and
  sandboxing are on; IPC is restricted to the app's own window. All colors come from theme tokens (CSS
  variables) and the stock Tailwind palette is disabled; Sora and Figtree are bundled with the app.

Design decisions are recorded in [`docs/decisions`](decisions).

## Repository layout

```
apps/api/        FastAPI app, Alembic migrations, pytest suite
apps/desktop/    Electron + React desktop app
scripts/         generate-sounds.mjs (UI sounds), e-mail and share images, test and release helpers
infra/           docker-compose files and LiveKit config
site/            the landing page (GitHub Pages)
docs/decisions/  architecture decision records
.env.example     every setting the stack reads
```

## Running locally

Requirements: Docker Desktop, Node.js 22+, and Python 3.12 (only to run the API tests from the host).

1. **Configure.** Copy `.env.example` to `.env` and replace every `change-me` value with a strong random
   secret. `.env` is git-ignored; secrets never go anywhere else.

2. **Start the stack** (from the repository root). The dev override publishes Postgres, Redis and MinIO on
   `127.0.0.1` and the `local-livekit` profile runs LiveKit in a container:

   ```sh
   docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml --profile local-livekit up -d --wait
   ```

   The API runs its migrations on startup and listens on `http://127.0.0.1:8000`
   (`/api/health`, interactive docs at `/api/docs`).

3. **Run the desktop app:**

   ```sh
   cd apps/desktop
   npm install
   npm run dev
   ```

   With `AUREUM_INVITE_ONLY=true` (the default) sign-up needs an account invite: create the first
   account and invites with the admin commands below. Set `EMAIL_PROVIDER` and `SMTP_*` in `.env` for
   the confirmation codes to go out.

### Tests

The API suite runs against real Postgres, Redis and MinIO, using a separate `aureum_test` database,
`aureum-test` bucket and Redis prefix. The simplest way runs it in a throwaway container on the
stack's network, so it works in dev or plan B mode without publishing ports or restarting anything
(the stack must be up). Extra arguments go to pytest:

```sh
node scripts/test-api.mjs
node scripts/test-api.mjs tests/test_attachments.py -x
```

With the stack in dev mode (ports published on 127.0.0.1) it can also run from a local venv:

```sh
cd apps/api
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt   # .venv/bin/pip on Linux/macOS
.venv/Scripts/python -m pytest
```

For the desktop app, `npm run typecheck` checks the main and renderer processes, and `npm test` runs
the component tests (Vitest + Testing Library in jsdom, no server needed).

### Sounds

The UI sounds (`apps/desktop/src/renderer/src/assets/sounds/*.ogg`) are synthesized by
`scripts/generate-sounds.mjs` and committed, so ffmpeg is only needed to change them. To regenerate,
install ffmpeg (`winget install ffmpeg` on Windows), edit the sound's entry in the script, and run:

```sh
cd apps/desktop
npm run sounds            # all sounds
npm run sounds -- message # only the named ones
```

Output is byte-identical between runs, so git only shows the sounds that actually changed. The sounds
are © Aureum, all rights reserved (see `docs/sounds/LICENSES.md`).

### Icons

Every app icon comes from the two official logos in `docs/design/brand`: `logo-small.svg` (filled, for
16–24px) and `logo.svg` (32px and up). `npm run build:icons` in `apps/desktop`
(`scripts/build-icons.mjs`, rendered by the app's own Electron, no extra dependency) writes
`build/icon.ico` (16–256px: exe, installer, uninstaller, shortcut, window) and `resources/tray-N.png`
(16/20/24/32px for 100–200% display scaling). Both are committed; rerun the script after changing a logo.

### Admin commands

Run inside the API container, from the repository root:

```sh
# prefix each with: docker compose --env-file .env -f infra/docker-compose.yml exec api
python -m app.cli users create --username edu --email <e-mail> --confirmado
python -m app.cli users create --username aureum --email <e-mail> --oficial --password
python -m app.cli users update --username aureum --oficial   # marks an existing account
python -m app.cli invites create --count 5                # single-use account invites
python -m app.cli invites create --usos 15 --dias 7       # one group invite
python -m app.cli invites create --pioneiro 2             # single-use, reserves Pioneiro #2
python -m app.cli servers set-official --server-id <id>   # everyone who confirms joins it
python -m app.cli badges grant <username> bug_hunter
python -m app.cli badges grant-all beta_tester            # says how many, then asks
```

`users create` also makes accounts sign-up refuses (reserved names such as `aureum`, `admin` or
`suporte`). Without `--password` it prints a temporary password once, which the app makes the user
replace at the first sign-in. `--confirmado` confirms the e-mail right away; `--oficial` marks a company
account (no beta badge, no invites) and shows a gold verified check and a "BOT" tag next to its name;
`--verificado` and `--bot` set those two on their own. `AUREUM_OWNER_USERNAME` in `.env` names the
owner's account, which reads the problems reported from the app (Settings > Problemas) and gets the
Founder badge. `AUREUM_BETA=true` gives accounts that confirm their e-mail the Beta Tester badge and,
while numbers last, the numbered Pioneiro (`AUREUM_PIONEER_LIMIT`, 20 by default; reserved numbers count).

### Building the Windows installer

```sh
cd apps/desktop
echo MAIN_VITE_API_URL=https://your-server.example > .env.production.local
npm run build:win
```

The installer is written to `apps/desktop/release/`. `MAIN_VITE_API_URL` is the server the app points to
by default; users can still change it on the sign-in screen. The installer is not code-signed, so Windows
SmartScreen shows a warning on first run (**More info → Run anyway**).

Installed apps update themselves from this repository's GitHub releases (checked at startup and every
6 hours, on the channel of the version, e.g. `beta`). To ship an update, raise `version` in
`apps/desktop/package.json` (e.g. `0.2.0-beta.2`), put a `GH_TOKEN` in the root `.env` (a fine-grained
token for this repository with "Contents: read and write"), then:

```sh
cd apps/desktop
npm run release
```

That uploads a **draft** release; it reaches people only after you publish it on GitHub.

## Landing page

`site/` is the public landing page, plain HTML, CSS and JS with no build step and no dependencies,
deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main` that touches it
(`https://eduoliveira1504.github.io/aureum-voice/`). It reads two things at runtime and works without
either:

- the newest installer from GitHub's public API (`/releases/latest`, then the release list, since beta
  builds are pre-releases), falling back to the releases page;
- the live Pioneiro count from `GET /api/public/stats`, which returns only `{ "pioneers": N }`, cached
  for 5 minutes and rate limited per IP. Only that route answers the page's origin
  (`PUBLIC_SITE_ORIGIN`); the app-wide CORS list stays closed. If the API is down, the count is hidden.

The share preview `site/img/og.png` is rendered by `npm run og-image` in `apps/desktop`
(`scripts/generate-og-image.mjs`), from `site/img/salas.png`. The app screenshots in `site/img/` come from
an isolated preview stack with fictional demo data, never from real accounts.

To try it locally, serve the folder with any static server, e.g. `python -m http.server -d site 4173`.

## Hosting

### Temporary deployment (plan B)

While the permanent server is not available, the app runs from a home PC at no cost:

- **Media** goes through **LiveKit Cloud** on the free plan. Its monthly quota is a hard cap, so running out
  only makes calls fail until the next month; nothing is ever billed.
- **API, Postgres, Redis and MinIO** run with docker compose on the PC. Only the API publishes a port, and
  only on `127.0.0.1`.
- **Public access** comes from **[Tailscale Funnel](https://tailscale.com/kb/1223/funnel)** (free), which
  gives the API a public HTTPS address on port 443 (`https://<machine>.<tailnet>.ts.net`). Nothing else on
  the PC is reachable.
- Friends only install the app; the installer is built with the Funnel address as its default server.

Hardening that is in place before exposing anything:

- sign-up requires an account invite; the only public page is the invite page (sign-up, e-mail code,
  download), which runs no inline scripts under a strict Content-Security-Policy
- password changes and resets end every other session (tokens carry a session epoch)
- login, sign-up, codes and every e-mail send are rate limited per client IP (the proxy's `X-Forwarded-For` is trusted only because
  the API port is bound to localhost) and per account for failed logins
- CORS and WebSocket `Origin` checks only accept the desktop app
- all secrets live in `.env`, which is git-ignored

**Set up**

1. Put the LiveKit Cloud project URL (`wss://<project>.livekit.cloud`), API key and secret in `.env` as
   `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.
2. Start the stack without the dev override or local LiveKit:

   ```sh
   docker compose --env-file .env -f infra/docker-compose.yml up -d --wait
   ```

3. Turn on Funnel for the API (on Windows the CLI is `"C:\Program Files\Tailscale\tailscale.exe"`). The
   first time, Tailscale asks you to enable HTTPS certificates and Funnel for the tailnet in its admin
   console.

   ```sh
   tailscale funnel --bg 8000      # expose 127.0.0.1:8000 at https://<machine>.<tailnet>.ts.net (persists across reboots)
   tailscale funnel status         # show the public address
   tailscale funnel --https=443 off  # stop exposing the API
   tailscale funnel reset          # remove all serve/funnel configuration
   ```

4. Build the installer with `MAIN_VITE_API_URL` set to the Funnel address and share it with your friends.

To go back to fully local development, run `docker compose ... down` for the plan B stack and start it again
with the dev override and `--profile local-livekit`. The data volumes are shared between both modes.

### Permanent deployment

The target is an Oracle Cloud Always Free VM running the whole stack, including a self-hosted LiveKit, behind
Caddy with automatic HTTPS. Plan B adds no dependency that prevents moving there: the desktop app gets the
LiveKit URL from the API, and the API URL is only a build setting.

## Roadmap

- Role mentions: the permission already exists
- The app's own sound set
- Add-ons: "watch together" (postponed until after the beta), later a BlueMap
  Minecraft map and listening to music together
- Sign in with Google and Discord (the `oauth_accounts` table is already in the schema)
