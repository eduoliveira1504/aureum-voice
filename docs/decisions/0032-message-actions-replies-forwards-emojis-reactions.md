# 0032 — Message actions, replies, forwards, emojis and reactions

- **Status:** accepted
- **Date:** 2026-10-26

## Context

Block 3.11, part A: a message gets a bar of actions (react, reply, forward, more), replies quote
the original, messages can be forwarded to other conversations, emojis get a picker and an
autocomplete, and messages take reactions. Before it, two beta bugs were fixed: chat images
showed a gray band beside them, and polls failed to create because the emoji field took the text
box's width. Everything applies to server channels, DMs and groups. The API runs while the
previous app version is still installed, so every change is additive.

## Decision

### Fixes before part A

- **Image size.** The API measures images on upload with Pillow (header only, EXIF turn applied)
  and keeps `{"width", "height"}` in `attachments.meta`; the attachment carries them. The app
  sizes a lone image's box from them (at most 360×320, never scaled up), so the room is saved
  before it loads and the box never runs past the picture. Files sent earlier have no size: the
  box shrinks to the image and takes its size once loaded. Videos get a box that fits the clip.
- **Class conflicts.** `inputClass` carries `w-full`, `py-2.5` and `text-[15px]`; adding `w-14`
  or `py-1.5` next to it depended on Tailwind's CSS order. Class lists are now joined with `cn()`
  (**tailwind-merge**, MIT, approved), where the later class of the same kind wins. The poll's
  option row puts the wide text field first; its emoji is a square button that opens the picker,
  so no text can land there.

### Actions bar and menu

- One set of actions (`MessageActions`: react, reply, forward, edit, delete) feeds the hover/focus
  bar, its "…" menu and the right-click menu; a missing handler means "not allowed here" and the
  item doesn't show. Shortcuts on the focused message: R, E, Del (asks first). Rows are focusable
  with `tabIndex=-1`, so a click focuses them without adding a tab stop per message.
- **Copy link** copies `aureum://mensagem/{channel}/{message}`. Pasted in any conversation of the
  app it becomes a button that opens the place and scrolls to the message (the existing focus +
  flash). The `aureum://` scheme isn't registered in Windows yet, so the link only works inside
  the app.
- **Mark as unread**: `POST /channels/{id}/unread {message_id}` moves the read marker to just
  before the message — the only way it moves back. Mentions are left as they are.

### Replies

- `messages.reply_to_id` (migration `e3a9c5b1d742`), **without a foreign key**: when the original
  is deleted the reply keeps the id and the app shows "Mensagem original apagada". A viewonly
  relationship (`lazy="joined"`, `join_depth=1`) loads the original with every message, so all the
  places that build `MessageOut` carry `reply_to` (id, author, first 200 characters, and `media`
  when there's no text: image, gif, video, voice, file, poll). Only messages of the same channel,
  and not call or addon lines (422).
- "@ Mencionar" (`mention_reply`, on by default) counts as a mention of the original's author in
  servers; in DMs every message notifies anyway, so the switch isn't shown there.

### Forwards

- `POST /messages/{id}/forward {channel_ids (1–5), comment}` (app/forwarding.py). Every
  destination is checked first (SEND_MESSAGES, and ATTACH_FILES when there are files; 1:1 DMs
  only with friends); nothing is sent unless all pass. 20 forwards per minute per person (Redis).
- The copy keeps a **snapshot** in `messages.forwarded_from` (migration `f4b8d6c2e953`):
  content, when it was sent and the source. A server source names the server and channel (the app
  links to it only when the viewer can open that channel); a private source says only
  `{"kind": "dm"}`, so who was in it stays there. Forwarding a forward with no comment passes the
  first snapshot on. The comment is the new message's own content (and its only mentions).
- Files get **their own attachment rows** in the destination, pointing to the same stored key, so
  downloads are checked against the destination channel. `attachments.delete_keys` now deletes a
  stored file only when no row points to it anymore.
- Server-only stickers (part C) will be refused outside their server here.

### Emojis

- **Twemoji** (graphics CC-BY 4.0, credited in Configurações › Sobre) so emojis look the same on
  Windows 10 and 11. The SVGs ship with the app: a Vite plugin (`vendorFiles`, generalized from
  the Excalidraw fonts one) serves `node_modules/@twemoji/svg` at `twemoji/` in dev and copies it
  into the build (~8 MB, 3.7k files). A virtual module (`virtual:twemoji-names`) lists the
  drawings, so the URL is exact (Twemoji's file names have exceptions) and the picker leaves out
  emojis newer than Twemoji; anything without a drawing shows as the system's emoji.
- Names, tags and categories in Portuguese come from **emojibase-data** (MIT), loaded on first
  use as separate chunks. Search ranks the exact name, then names starting with the text
  (shorter first), then words and tags.
- The picker is one global popover (`pickEmoji(anchor, onPick)`, `EmojiPickerHost`), like the
  context menu. Esc closes only it, even over a modal. Skin tone and recent emojis live in the
  user's settings (`emoji_tone`, `recent_emojis`; migration `a5c1e7f3b864`), on every PC.
- ":" + 2 letters in the message box suggests emojis (↑/↓, Enter/Tab, Esc). A message with only 1
  to 3 emojis shows them big, without the bubble. Emojis stay content only, never UI icons.

### Reactions

- `message_reactions (message_id, user_id, emoji)` as the primary key (migration `b6d2f8a4c975`).
  `PUT`/`DELETE /messages/{id}/reactions/{emoji}`; `DELETE …/{emoji}/{user_id}` with
  MANAGE_MESSAGES. In servers a new emoji needs ADD_REACTIONS, adding to one already there
  doesn't; 1:1 DMs need friendship (like writing); the official DM takes reactions. Up to 20
  different emojis per message. The API checks the value is a single emoji, loosely (no letters,
  spaces or controls; a non-ASCII symbol or a keycap). Reactions notify no one.
- They aren't an ORM relationship of `Message`: many places build `MessageOut` from messages just
  created, where loading a relationship would break. `MessageOut.reactions` is optional: the
  history and edits fill it, `null` means "not included", and the app keeps what it has. Every
  change goes out as `message.reactions` with the message's whole summary (emoji, count, who).
- The app shows its own change right away and goes back if the API refuses.

## Consequences

- Five core migrations (`e3a9c5b1d742` → `b6d2f8a4c975`), all additive: the previous app ignores
  the new fields and keeps working.
- The installer grows by the Twemoji drawings (~8 MB uncompressed).
- Message links work only inside the app until the `aureum://` scheme is registered.
