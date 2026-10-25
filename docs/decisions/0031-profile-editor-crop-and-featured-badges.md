# 0031 — Profile editor, image cropping and featured badges

- **Status:** accepted
- **Date:** 2026-10-25

## Context

Block 3.10: the profile is edited from the profile card instead of only in Settings; avatars,
profile banners and server icons/banners get a crop editor (including animated GIF/WebP); and
people pick which badges show next to their name, while everyone can see every badge they have.
The API runs while apps of the previous version are still installed, so neither change may break
them.

## Decision

### Cropping on the API, with the original kept

- The app never re-encodes images. Its editor only works out a rectangle (`ImageCrop`: `x`, `y`,
  `width`, `height` in the original's pixels after a clockwise quarter turn `rotate`), and sends it
  as a JSON form field `crop` next to the original file. The API crops with **Pillow** (HPND
  license, approved), frame by frame for animated GIF and WebP, keeping each frame's duration and
  the loop count (no loop key: it still plays once). The output keeps the input's format and is
  scaled down (never up) to fit 512×512 for avatars and icons, 1600×800 for banners.
- The original goes under `originals/{prefix}/…`, a prefix `/api/media` never serves. The model
  keeps `{kind}_source` (`{"key", "crop"}`, JSONB; migration `c6e1a9d4f357`) next to `{kind}_url`.
  `GET …/{kind}/original` hands it to whoever may change the image (the user; `MANAGE_SERVER` for a
  server), and `PUT …/{kind}/crop` re-crops it ("Ajustar posição") without another upload.
  `UserMe` and `ServerOut` expose only the crop (`avatar_crop`, `icon_crop`…), never the key.
- Replacing or removing an image deletes the files only the old one used (crop and original);
  if saving fails, the new files are deleted instead (`images._swap`).
- An upload without `crop` is stored untouched, as before: older apps keep working, and their
  images have no "Ajustar posição".
- Limits stay the same: 8 MB in and out. Decoding is capped (50 M pixels a frame, 100 M across
  frames) so a small file can't unpack into gigabytes; an image Pillow can't read gives 422.

### The crop editor (app)

- `lib/crop.ts` is plain geometry: the view is a turn, a zoom (1x = the image just covers the
  frame, up to 4x) and the image point at the frame's center, always clamped so the frame stays
  inside the image. The same layout draws the editor and the previews at any size, with CSS
  transforms over the untouched `<img>`, so GIFs keep playing while editing.
- Frames: round 280 px for avatars, rounded square for icons, 17:6 for the profile banner (the
  card's 340×120) and 3:1 for the server banner. Drag, mouse wheel, slider, arrow keys and +/−.
- `Modal` keeps a stack, and Escape closes only the topmost one, so the editor or a confirmation
  over Settings no longer closes Settings too.

### One profile editor

- `ProfileEditor` is the only editor: Configurações › Meu perfil shows it, and "Editar perfil" on
  your own profile card opens it in a modal (`useNav.profileEditor`, mounted once in the shell).
  Whoever hosts it gets `onDirtyChange`; closing, switching settings tabs or signing out with
  unsaved changes asks first (`useUnsavedGuard`). The separate badges page in Settings is gone.

### Featured badges and the inventory

- `user_badges.featured_position` (nullable; migration `d7f2b4e8a913`): up to 3, set together by
  `PUT /users/me/badges/featured {keys}` (only badges the user holds, each once). An empty list
  means "no choice": the app shows the two rarest, as before ([ADR 0026](0026-beta-badges.md)). A
  newly granted badge has no position, so it never joins a choice by itself; @aureum's notice
  offers "Destacar no perfil" (with three featured already, it opens the editor instead).
- In the editor the pick is part of the draft, previewed live and saved with the profile (the
  profile `PATCH`, then the featured `PUT` only if it changed).
- The catalog gains `how_to_get` (copied from `app/badges.py` like the rest) and a computed
  `available`: false for one-of-a-kind badges (Fundador), beta-only ones after the beta, and
  Pioneiro once its numbers ran out. Locked badges show what earns them, or "Não disponível mais".
- The inventory (the card's Insígnias tab) lists the person's badges rarest first, then the ones
  they lack, earnable before unavailable. It's the same for everyone who opens the profile; on
  your own card, "Destacar" shows on hover.

## Consequences

- The API image now needs Pillow (wheels for the slim image, no system packages).
- Older apps ignore the new fields: they keep uploading uncropped images and showing the two
  rarest badges, even for someone who picked theirs.
- Originals double what an image costs in MinIO, which is fine at beta size. A server's images
  (like before) aren't removed when the server is deleted; a cleanup can come with the Oracle move.
