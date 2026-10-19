# 0018 — Pre-beta: updates, bug reports, badges, reserved accounts, voice messages and push-to-talk

- **Status:** accepted
- **Date:** 2026-10-20

## Context

Block 2.9 gets the app ready for the first testers. They need a few things: updates that reach them
without a new installer, a way to report problems, the beta badges, an official account nobody can
impersonate, and two communication features (voice messages and push-to-talk). The project costs
nothing to run, so everything here is free: GitHub releases of the public repository, and the
existing MinIO and Postgres. The per-server theme planned for this block was dropped from scope.

## Decision

**Automatic updates**
- `electron-updater` reads the GitHub releases of the public repository, so the app needs no token.
  It checks when the app opens and every 6 hours, downloads in the background, and shows
  **Reiniciar para atualizar** in the top bar. If the user never clicks, the update installs when
  the app really quits. It only runs in the installed app.
- The channel comes from the version: `0.2.0-beta.N` publishes and follows `beta.yml`. The appId
  stays `com.aureum.voice`.
- `npm run release` (`scripts/release-desktop.mjs`) builds and uploads a **draft** release with
  `GH_TOKEN` read from the root `.env`. Nothing reaches testers until the draft is published on
  GitHub. A version must be higher than the last one to be offered.

**Bug reports**
- **Opening it:** profile menu or Ctrl+Shift+R. The main process catches Ctrl+Shift+R in
  `before-input-event`, because in Electron's default menu that key forces a reload.
- **What it sends:** a description, the app version, the OS and the app's last 300 log lines. The
  logs come from the main and renderer consoles, are kept in memory only, and have tokens, auth
  headers, `token=` values and e-mails removed as they arrive (`shared/redact.ts`). The user can
  read them in the dialog before sending.
- **Screenshot:** the window is captured before the dialog opens, so it shows what the person was
  looking at. The screenshot is **off by default**, because it may show private conversations.
  When ticked, a preview shows with a way to remove it.
- **Storage and access:** `bug_reports` table; the screenshot goes to MinIO under `bug-reports/`,
  which `/api/media` doesn't serve publicly. Only the account in `AUREUM_OWNER_USERNAME` lists
  reports, downloads screenshots (`/api/media/bug-reports/{id}`) and marks reports resolved. Everyone
  else gets 404. Reports are limited to 5 per 10 minutes per user.

**Badges**
- **Catalog:** lives in `app/badges.py` and is synced into the `badges` table when the API starts.
  Adding a badge is one entry there. Grants (`user_badges`) point to the badge id, so renaming a
  badge or swapping its art never changes who holds it or their numbers. The old `users.badges`
  list was migrated: `founder` stays, and `beta` becomes the numbered `pioneer` in sign-up order.
- **Rules:**
  - Founder (mythic) goes to `AUREUM_OWNER_USERNAME`, at sign-up or when the API starts if the
    account already exists.
  - Pioneiro #N (mythic, numbered) goes to accounts created through sign-up while `AUREUM_BETA=true`.
    A transaction advisory lock serializes the numbering.
  - Caçador de bugs (rare) goes to the author of a report the owner marks resolved, once. Reopening
    keeps it.
  - Mythic badges are `exclusive_beta`: once the beta is off they're refused, even from the CLI.
- **API shape:** profiles carry only `{key, number, granted_at}`. The art and texts come from
  `GET /badges`, loaded once per session, so user payloads stay small.
- **Display:**
  - Each SVG already contains its frame and metal. The app draws it as an image, never as injected
    markup, and uses the small art at 32 px and below.
  - Mythic ones glow, and a light band crosses them every ~4 s, masked by the badge's own art. This
    is CSS in the component, with colors in tokens. It runs by itself on the profile card and in
    the tooltip, only on hover in lists, and never with reduced motion.
  - The profile card shows up to 5 badges, rarest first, then "+N". Lists (members, chat authors,
    call tiles) show only the rarest one next to the name.
- Veterano, Construtor and Aureum+ are only planned: they're added once they have art.

**Reserved accounts**
- Sign-up refuses `aureum`, `admin`, `administrador`, `suporte`, `support`, `staff`, `equipe`,
  `sistema`, `system`, `oficial`, `official`, `moderador` and `mod`, in any case. The app then shows
  "esse nome é reservado". Usernames can't be changed later, so sign-up is the only gate.
- `python -m app.cli users create <username> --email ...` creates such accounts from the terminal.
  It asks for the password twice and validates it like sign-up does. These accounts get no beta
  badge and take no number. The owner's account still gets Founder if it's made this way.

**Voice messages**
- **Recording:** a new attachment kind `voice`, recorded with MediaRecorder as Opus/WebM at
  32 kbit/s, up to 5 minutes (it stops and sends at the limit).
- **Waveform and duration:** the app measures loudness while recording and sends the duration plus
  up to 64 bars (0–100) with the upload. They're stored in `attachments.meta` and copied into the
  message, so the player draws them without decoding the file.
- **Server checks:** the file must be WebM, the duration at most 5 minutes and the waveform well
  formed. The permission is the same as for any file (ATTACH_FILES).
- **Composer:** hold the mic button and release to send, or click to start and send with the same
  button. While holding, dragging 80 px left cancels; Esc cancels too. Recordings under half a
  second are dropped.
- **Player:** play/pause, a clickable waveform, the time and 1x/1.5x/2x speed, on the chosen output
  device, one message at a time.

**Push-to-talk**
- **Setting:** Settings > Voz e vídeo picks **Detecção de voz** or **Pressionar para falar** and the
  key. It can be a letter, a digit, F1–F24, Ctrl/Alt/Shift, \`, Caps Lock or a side mouse button.
  It's saved on this PC. Without a key the mic keeps working by voice activity.
- **Reading the key:** reuses the 2.7 key watch (`GetAsyncKeyState`), which now also reports
  releases. It works with the app in the background and in games that block global shortcuts. The
  privacy rule is the same: only the configured key is read, only while in a call in that mode.
- **Mic behavior:** in that mode the mic is published muted, so a press opens it at once. A release
  waits 200 ms so the last word isn't cut. Presses aren't announced: others see the user's mute
  state, not every press.
- **Sounds:** `ptt-on` and `ptt-off` are new short ticks from the same synthesizer (E major). They
  can be switched off in the push-to-talk settings or in Settings > Sons.

## Consequences

- **Updates:** releases must be published by hand on GitHub. Until the installer is code-signed,
  SmartScreen warns on first install.
- **Bug report logs:** they only cover the current session, since nothing is kept on disk. A crash
  that closes the app loses them.
- **The owner:** decided by an environment variable. Moving to the VM needs the same
  `AUREUM_OWNER_USERNAME`, and the owner account must keep that username.
- **Seeking in voice messages:** Chromium's WebM recordings have no seek index, so seeking may be
  imprecise in long messages. Adding cues on the server would mean remuxing (ffmpeg), which isn't
  worth it for 5-minute clips.
- **Push-to-talk mic:** the mic stays captured (muted) during a push-to-talk call, so Windows shows
  it as in use.
