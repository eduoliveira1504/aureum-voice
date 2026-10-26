# 0034 — Stickers and GIFs

- **Status:** accepted
- **Date:** 2026-10-27

## Context

Block 3.11, part C: stickers (Aureum's own packs, usable everywhere, and each server's) and GIFs
from a provider. Tenor's API closed on 30/06/2026; Eduardo picked **Klipy**. Before building, its
current terms were checked (docs.klipy.com, October 2026): free, a test key with 100 calls/hour and
a production key without a limit (asked for in the Partner Panel), optional ads (off), and
**integration requirements** that rule out what the spec had planned for GIFs: search and trending
must be called from the user's app, media loaded straight from Klipy's URLs, and no proxy, cache,
re-hosting, reordering or filtering of results by the partner without Klipy's written approval.
Attribution: "Search KLIPY" as the search box's placeholder (required), "Powered by KLIPY"
(optional). Eduardo chose Klipy's standard integration over asking for an exception.

## Decision

### Stickers

- `sticker_packs (id, name, is_global, server_id unique, position)` and `stickers (pack_id, name,
  emoji, key, width, height, position, created_by)`, migration `a9c5e1f7b308`. Global packs come
  only from the CLI (`stickers pack-add [--pasta]`, `sticker-add`, `list`); a server's pack is
  made with its first sticker.
- Only static images for now: PNG or WebP up to 512 KB, checked by their bytes (an animated one is
  refused), scaled down to fit 320×320 and stored as WebP, so what's kept is always a plain still
  picture. Up to 30 per server; name 2–30 characters and an optional emoji for search.
- Files are served by `/api/media/stickers/{id}` with the token: anyone for Aureum's, members for
  a server's (404 otherwise). The app loads them like attachments (blob URLs, memory and disk
  cache; sticker ids are UUIDs too). A sticker removed after it was cached still shows from the
  cache on that PC; everywhere else the message shows it's gone.
- Permissions: **MANAGE_EXPRESSIONS** (1 << 26, server-wide: add, rename, remove the server's
  stickers) and **USE_STICKERS** (1 << 27, per channel, on for @everyone by default and given to
  the @everyone of existing servers by the migration). Both stay under 1 << 30 for the app's
  32-bit math.
- A sticker message: `POST /channels/{id}/messages {sticker_id}`, alone (no text or files). It keeps
  a **snapshot** (`messages.sticker`: id, name, pack, server, url, size) and a fallback content
  "[Figurinha: nome]" that older apps show. A server's sticker can only be sent in its server, and
  forwarded only within it; any sticker in a server needs USE_STICKERS. Not editable. Replies quote
  it as "figurinha".
- The picker of the message box gets a "Figurinhas" tab: recent ones first (in the settings,
  `recent_stickers`, synced), Aureum's packs, this server's, then the user's other servers' shown
  locked with "Só no servidor X". Search by name (accents ignored) or emoji. The forward picker
  shows places a server's sticker can't go as blocked, with why.

### "Aureum básico"

- 16 stickers drawn as SVG in the brand look: the logo's hexagon as a face (gold, ink outline, the
  white edge of a die-cut sticker) with an expression and a word in Sora: bom dia, oi, kkkk, GG,
  bora?, tô dentro, valeu, amei, brabo, parabéns, triste, socorro, calma, foi mal, dormindo, boa
  noite. Not a mascot (that comes in 3.17). Approved by Eduardo from the review sheet.
- `scripts/build-stickers.mjs` (`npm run build:stickers`, with the desktop app's Electron, like
  the icons) writes the sources to `docs/design/stickers/aureum-basico/`, a review sheet, and the
  320×320 PNGs with a `stickers.json` (names with accents, emojis) to
  `apps/api/app/static/stickers/aureum-basico/`, which ships in the API image, so production only
  runs `stickers pack-add --nome "Aureum básico" --pasta app/static/stickers/aureum-basico`.

### GIFs (Klipy, standard integration)

- **The app calls Klipy itself** (`api.klipy.com/api/v1/{key}/gifs/trending|search`), as Klipy
  requires. The key lives in `.env` (`KLIPY_APP_KEY`; empty turns GIFs off) and reaches the app
  through `GET /api/gifs/config`, so it can be swapped without a release; it's a client key by
  Klipy's design. With it go an anonymous `customer_id` (an HMAC of the user id with the JWT
  secret: stable per user for Klipy, meaningless elsewhere), `content_filter=high` (the safest)
  and `locale=br`. This replaces the spec's plan of a proxy with our own cache and rate limit,
  which Klipy doesn't allow without written approval; the provider layer stays small (app/gifs.py
  and store/gifs.ts) so another provider can come in later.
- Results are shown in Klipy's order, in a GIFs tab of their own (the GIF button opens the picker
  on it), with "Search KLIPY" in the search box and "Powered by KLIPY" under it, and in
  Configurações › Sobre. Ads stay off.
- **Media load straight from Klipy's URLs** (`static*.klipy.com`), never copied to MinIO, so
  whoever sees a GIF fetches it from Klipy (the spec already had GIFs outside MinIO). The message
  keeps what was sent (`messages.gif`, migration `b0d6f2a8c419`): provider, id, title, the URL to
  play (MP4 preferred, then WebP), a still, and the size, with the URLs **as Klipy gave them**. The
  API accepts only https URLs on Klipy's media hosts. Fallback content "[GIF: título]". In servers
  it needs SEND_MESSAGES and ATTACH_FILES, forwards included. Not editable.
- Playback: muted, in a loop, at its own size (at most 360×320), paused when it scrolls away
  (IntersectionObserver). With `prefers-reduced-motion` it shows its still and plays only while the
  mouse is over it.
- **Favorites**: `gif_favorites (user_id, provider, gif_id, data)`, up to 200, `GET/PUT/DELETE
  /api/gifs/favorites`, synced live (`gifs.favorites`). The star is on the GIF in the picker and in
  messages. They keep Klipy's URLs, not files.
- Klipy down, off or unreachable: the tab says GIFs are out for now; the chat isn't affected.

## Consequences

- Two core migrations (`a9c5e1f7b308`, `b0d6f2a8c419`), additive: older apps show the fallback text
  of sticker and GIF messages.
- Production needs, once: the Aureum básico pack added with the CLI, and Eduardo's Klipy account
  (free) with its key in `.env`; the production key is asked for in the Partner Panel (the test
  key allows 100 calls/hour).
- People who see GIFs contact Klipy's servers directly (their IP reaches Klipy), unlike link
  previews; that's Klipy's condition for free use.
- The Klipy key is visible to anyone who inspects the app. Klipy's keys are made for clients; if it
  is abused, it's replaced in `.env` without a release.
