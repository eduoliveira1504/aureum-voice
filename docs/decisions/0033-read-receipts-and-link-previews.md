# 0033 — Read receipts and link previews

- **Status:** accepted
- **Date:** 2026-10-26

## Context

Block 3.11, part B: 1:1 DMs show whether my messages were seen, and messages with links show a card
for them. The API runs while the previous app (beta.6) is still installed, so every change is
additive. The API also runs on a home PC behind Tailscale Funnel (plan B), next to Postgres,
Redis and MinIO, so anything that fetches a URL chosen by a user must not be able to reach that
network.

## Decision

### Read receipts (1:1 DMs only)

- Built on the read state that already exists: what the other person read is their
  `channel_reads.last_read_message_id`. Nothing new is stored per message.
- `user_settings.read_receipts` (migration `c7e3a9f5d186`, on by default), shown as
  Configurações › Privacidade › "Confirmação de leitura". It works both ways: the value is shown
  only while **both** people have it on, so whoever turns it off stops seeing the other's too.
- `DmOut.peer_read_message_id`: set for a 1:1 DM that isn't the official one, when both have it
  on; `null` otherwise. Servers and groups never have it (app/receipts.py).
- Live changes go out as a **new event**, `dm.read` `{channel_id, last_read_message_id}`, to the
  other person. Not `read.updated`: the app (beta.6 included) takes that one as the viewer's own
  read state, so it would clear their own unread badge. Reading sends `dm.read` only while it's
  visible; turning the setting on or off sends it to both sides of each DM (`null` hides it).
  "Marcar como não lida" doesn't send it: the other side keeps the "Vista" it already saw.
- The app marks only two messages, so the chat stays clean: "✓✓ Vista" (accent color) on the last
  of my messages the other person read, and "✓ Enviada" on my last one while it hasn't been read.
  Icons are lucide's check and double check, not emoji.

### Link previews

- **The API fetches, never the app**, so the people who receive a message don't show their IP to
  the site. The site sees the server's IP instead (today the home connection of the plan B; the
  Oracle VM later).
- **app/safe_fetch.py** does the fetching with httpx (already a dependency):
  - only `http` and `https`; no proxies from the environment, no cookies;
  - every address the name resolves to must be public (`is_global`, not multicast, not
    100.64/10, IPv4-mapped IPv6 unwrapped): localhost, 10/8, 172.16/12, 192.168/16, link-local
    (169.254, so cloud metadata too), Tailscale/CGNAT and the Docker network are refused;
  - checked before each request and again on every redirect (up to 3, followed by hand);
  - checked **again when the socket connects**: a custom httpcore network backend resolves the
    name itself and connects only to a checked public address, so a DNS answer that changes
    between the check and the connection (DNS rebinding) can't reach inside. TLS still verifies
    the certificate against the name. httpx doesn't take a network backend, so the transport
    replaces its connection pool with one that has it (same defaults);
  - 5 s for the whole fetch, at most 1 MB read.
- **What a card holds** (`messages.link_previews`, migration `d8f4b0a6e297`): url, kind (`link` or
  `youtube`), site, title (200 chars), description (300), image path and size; for YouTube the
  channel and the video id. Pages give their OpenGraph tags (then Twitter card tags, then
  `<title>` and the description meta). YouTube links (watch, youtu.be, shorts, live, embed) use
  YouTube's **oEmbed** (free, no key; title and channel) and the `hqdefault` thumbnail. The play
  button opens the video in the browser; nothing plays inside the app.
- **Images** are fetched by the API too (same guard and limits), re-encoded with Pillow as a WebP
  of at most 640 px, and stored in MinIO under `previews/`, named by the hash of the WebP itself,
  so a key never goes stale and `/api/media` serves it with the same long cache as avatars. The app
  only shows card images whose path is `/api/media/…`. Re-encoding also drops anything that isn't
  the picture. These files aren't deleted with the message for now (small, shared between
  messages that link the same page).
- **Cache**: each URL's result is kept in Redis for 24 h; a link that gave nothing or failed is
  tried again after 1 h, so a site that was down for a moment doesn't stay without a card all day.
- **When**: the card is filled **after** the message is sent (`link_previews.schedule`, an
  asyncio task), so sending never waits for a site. It arrives as `message.updated` (without
  `reactions`, which means "keep what you have"; no `edited_at`). The beta.6 app ignores the new
  field. If the message was edited or its cards removed meanwhile, the late result is dropped.
- Up to **3** links per message. A link between `< >` gets no card. The link rule is the app's
  (`https?://` up to a space, `<` or `>`, without the final punctuation), now in both places.
- **Removing**: `DELETE /messages/{id}/previews`, by the author only, removes all of the message's
  cards and sets `previews_removed`, so later edits don't bring them back. An edit that changes the
  links swaps the cards; one that keeps them leaves them alone.
- **Forwards** carry the original's cards (part of the snapshot); nothing is fetched again.
- Tests never reach the real web: an autouse fixture makes DNS fail and every site answer 503;
  the preview tests bring a fake DNS table and an `httpx.MockTransport`, and the address checks
  run as they do for real.

## Consequences

- Two core migrations (`c7e3a9f5d186`, `d8f4b0a6e297`), both additive: the previous app ignores the
  new fields and keeps working.
- The API now makes outbound HTTP requests, only for link previews and only to public addresses.
  Each site linked in a chat sees the server's IP and the `AureumPreview/1.0` user agent.
- Preview images accumulate under `previews/` in MinIO; a cleanup of unused ones can come later.
