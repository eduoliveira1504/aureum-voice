# 0015 — Chat attachments and running in the background

- **Status:** accepted
- **Date:** 2026-10-19

## Context

Polish block, part 2. People need to send files in server channels, DMs and groups: the "+" button,
drag and drop, and pasting images with Ctrl+V, with an upload progress bar. Images open full screen,
short videos play inline, and other files download. The limit is 25 MB per file, set in `.env`.
Someone who can't see a conversation must not be able to download its files. The 2.9 voice messages
will use the same system.

The app should also behave like other communication apps: the X hides it in the tray, it stays
connected, and only one copy runs at a time.

## Decision

**Attachments are uploaded first, then sent**
- `POST /channels/{id}/attachments` stores one file and returns its id. The app uploads each file
  as soon as it's added, which is what makes per-file progress possible. The message then sends
  `attachment_ids` (up to 10), and its text can be empty.
- The `attachments` table is the source of truth: channel, uploader, message (NULL until sent), the
  MinIO key, name, kind and size. Messages keep a copy of the public fields in `messages.attachments`,
  so listing history needs no join and `MessageOut` didn't change.
- Uploading checks the same rights as sending, plus `ATTACH_FILES` in servers (friends only in a 1:1
  DM). Only the uploader can attach their own pending files, in the same channel, and only once.
- Pending uploads older than 24 hours are deleted the next time that person uploads. There are at
  most 50 per person.

**The bytes decide how a file is shown**
- PNG/JPEG/GIF/WebP are `image`, MP4/QuickTime/WebM are `video`, and everything else is `file`,
  served as `application/octet-stream` with `Content-Disposition: attachment`. The client's claimed
  type is ignored, so an uploaded HTML page can never render from the API's origin. Responses also
  carry `nosniff` and `Content-Security-Policy: sandbox`.
- File names are stripped of folders and of characters Windows can't save.

**Downloads need the token**
- `GET /api/media/attachments/{id}` requires a valid access token and the caller must see the
  channel. It answers 404 otherwise, so ids can't be probed. Avatars and banners stay public under
  `/api/media/{key}`, as before.
- An `<img>` tag can't send a token, so the app fetches each file itself and shows it through a blob
  URL. The alternative was short-lived signed URLs. They work in plain tags, but anyone with the link
  could still download the file until it expired, and access was only checked when the link was
  issued. Fetching with the token checks access on every request: a member who loses a channel stops
  getting its files right away.
- The app keeps what it fetched so scrolling back doesn't download it again. It uses up to 150 MB of
  memory (blob URLs, least recently used dropped first) and 500 MB on disk under
  `userData/attachment-cache` (main process, files named by attachment id). Ids never change, so
  the cache never goes stale. Logging out deletes the whole cache. Files the user just sent go
  straight into it.

**Cleanup**
- Deleting a message, a channel, a server or the last member's group also deletes the MinIO
  objects. The keys are collected before the rows go and deleted after the commit, so a failed
  commit leaves no file missing.

**Background**
- The window's `close` is prevented and the window hidden unless the app is really quitting (tray
  "Sair do Aureum", Windows shutdown) or the user chose "Sair" in Settings > Windows. The first time,
  a tray balloon explains it.
- The tray icon is drawn in code: a coin in the default gold accent, so the repo needs no binary icon.
  Its menu has open, mute, deafen, status and quit. The renderer reports the mic and status, and the
  menu sends commands back over IPC. The commands use the same store actions as the UI buttons.
- `backgroundThrottling: false` on the window: hidden, Chromium would slow the timers that keep the
  WebSocket alive (the server drops a connection silent for 60 s).
- "Iniciar com o Windows" is on by default and registers `--hidden` (starts in the tray). It is only
  applied in the installed app; in development it would register the bare Electron binary. These
  settings stay on the PC (`settings.json`), like the overlay's.
- A single instance already existed. A second launch now also brings the window back from the tray.

## Consequences

- Each image costs one authenticated request the first time it's seen, then none. Memory stays
  bounded by the cache limits.
- The API holds each upload in memory while handling it, so 25 MB per request. That's fine for the
  beta; streaming to MinIO can come with larger plans.
- Voice messages (2.9) will be an attachment with an `audio` kind added to the sniffer.
