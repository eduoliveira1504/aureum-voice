# 0044 — GIFs from Klipy as avatar and banner

- **Status:** accepted
- **Date:** 2026-11-08

## Context

Block 3.22, part B: besides uploading an image, people pick a GIF from the chat's picker (Klipy:
search, Em alta, Favoritos) as their avatar or profile banner, cropped like an upload (3.10,
[ADR 0031](0031-profile-editor-crop-and-featured-badges.md)). The spec asked to re-read Klipy's
terms first. docs.klipy.com/integration-requirements (read 08/11/2026) says, for standard
integrations: *"Do not store, mirror, re-host, rewrite, or retain copies of KLIPY media unless
KLIPY has approved a different delivery method in writing"*, media URLs are used as provided
(parameters and identifiers untouched), media loads from the user's app (no partner servers or
proxies), and any caching needs Klipy's approval before it's built. Nothing there is specific to
profile pictures, so the general rule applies: no copy. The upload path (the API downloads and
crops the GIF with Pillow) is therefore out, as in [ADR 0034](0034-stickers-and-gifs.md).

## Decision

- **A reference, not a file.** `PUT /users/me/{avatar|banner}/gif {gif, crop}` takes the GIF as the
  picker has it (`GifIn`: id, title, the URL to play, its format, a still, the size; only https
  URLs on Klipy's media hosts) and an `ImageCrop`, which must fit the GIF (turned when `rotate` is
  90/270). It stores `{kind}_source = {"gif": snapshot, "crop"}` in the existing JSONB column (no
  migration), never touching MinIO. Replacing an uploaded image deletes its files as before; an
  upload replaces the GIF the same way. With GIFs off (no Klipy key) the route answers 409.
- **Who sees it.** `UserPublic` gains `avatar_gif` / `banner_gif` (the snapshot plus the crop), so
  every app can draw it. `{kind}_url` gets something an `<img>` plays: the GIF's own URL (WebP/GIF),
  or its still when it is an MP4, so older apps show the uncropped GIF or its still instead of
  nothing. `{kind}_crop` (UserMe) keeps working, and `PUT …/crop` ("Ajustar posição") only updates
  the reference's crop. `GET …/original` is 404 for a GIF: the app loads it from Klipy.
- **Drawing.** The apps load the media straight from Klipy's URLs, untouched, and apply the crop
  with the same CSS layout as the crop editor's previews (`lib/crop.ts`), a `<video>` (muted, in a
  loop) for MP4 and an `<img>` otherwise. If the media no longer loads (removed from Klipy), the
  avatar falls back to the initials and the banner to the profile color.
- **Content.** The same check as the chat's GIFs: the picker searches with `content_filter=high`
  (the safest) and the API accepts only Klipy's media hosts. The API never calls Klipy itself
  (the terms ask for requests from the user's app).

## Consequences

- Whoever sees a GIF avatar contacts Klipy's servers directly (as with GIFs in the chat).
- If Klipy removes a GIF, the profile silently goes back to the default until the owner picks
  another; nothing of ours keeps showing it.
- Places that only get a URL (overlay notices, whiteboard cursors) show the GIF (or its still)
  uncropped, centered; the rest of the app shows the crop.
