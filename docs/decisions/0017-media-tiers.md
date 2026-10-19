# 0017 — Media tiers: streaming quality limits from the server

- **Status:** accepted
- **Date:** 2026-10-19

## Context

Polish block, part 4. Everyone gets the same default limits: screen share and camera up to 720p.
Screen sharing offers two modes. "Texto nítido" is 720p at 15 fps with `contentHint` 'detail' and
favors resolution. "Movimento" is 720p at 30 fps with 'motion' and favors frame rate. The limits must
come from the server, ready for a future paid plan (Aureum+) that raises them.

Until now the app shared screens at up to 1080p, chosen on its own. That also costs more of the
LiveKit Cloud free quota, which is counted in download bandwidth.

## Decision

**The plan lives on the user; the tier is a table**
- `users.plan` stores 'free' for everyone (a string enum, so new plans are one migration). It isn't
  exposed or editable through the API yet.
- `app/media.py` maps each plan to a `MediaTier`: `max_screen`, `max_camera` (720p / 1080p / 1440p)
  and `max_fps`. Free is 720p, 720p, 30. A plan with no entry gets the free tier, so adding a plan
  name can never break calls.
- `POST /channels/{id}/voice/token` returns `media` next to the token, in server rooms and private
  calls alike. Snake case like the rest of the API: `{ plan, max_screen, max_camera, max_fps }`.

**The app applies it**
- LiveKit's token decides *which* sources may be published, not their resolution or frame rate, so
  the client enforces the numbers. The voice store keeps the last tier (free until a token says
  otherwise).
  - **Camera:** captured and encoded at the tier's resolution, frame rate capped. The 180p/360p
    simulcast layers are unchanged.
  - **Screen:** `getDisplayMedia` is constrained to the tier's size and the mode's frame rate, and
    the top layer is encoded with LiveKit's tuned bitrate for that size and rate. "Texto nítido"
    uses `contentHint = 'detail'` and `maintain-resolution`; "Movimento" uses 'motion' and
    `maintain-framerate`. A 360p layer (3 fps for text, 15 fps for motion) stays for small tiles, so
    adaptive stream still sends small tiles the small layer.
- The picker shows each mode's real limits ("720p · 15 fps") from the tier, so a bigger plan shows
  up there with no UI change.

## Consequences

- A modified client could publish above its tier. That's acceptable for a free product with no paid
  plan yet. When Aureum+ exists, the API can check published track dimensions through LiveKit
  webhooks or its server API, and mute tracks that go over the tier.
- Lowering screen sharing from 1080p to 720p cuts its bitrate roughly in half, which stretches the
  LiveKit Cloud quota in plan B.
