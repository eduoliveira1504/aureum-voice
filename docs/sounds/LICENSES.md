# Sound licenses

**© Aureum. All rights reserved.**

Every UI sound in Aureum is original and is part of the brand identity. No file was taken from
another app (Discord or any other), a sound library or a third party, and no sample is used. Each
one is synthesized from scratch by [`scripts/generate-sounds.mjs`](../../scripts/generate-sounds.mjs)
(additive synthesis of a light bell, notes in E major) and encoded to Ogg Vorbis with ffmpeg. The
copyright notice is also written into each file's metadata.

The sounds are **not** CC0 or open licensed. They may not be reused outside Aureum without permission.

Files live in `apps/desktop/src/renderer/src/assets/sounds/`. To regenerate them, see "Sounds" in the
README.

| File | Event | Notes | Origin | License |
|---|---|---|---|---|
| `call-join.ogg` | you join a call | E5 → B5 | synthesized, generate-sounds.mjs | © Aureum, all rights reserved |
| `call-leave.ogg` | you leave a call | B5 → E5, darker | synthesized, generate-sounds.mjs | © Aureum, all rights reserved |
| `user-join.ogg` | someone joins your call | G#5 → B5, quieter | synthesized, generate-sounds.mjs | © Aureum, all rights reserved |
| `user-leave.ogg` | someone leaves your call | B5 → G#5, quieter | synthesized, generate-sounds.mjs | © Aureum, all rights reserved |
| `mute.ogg` | you mute | B4, dry and muffled | synthesized, generate-sounds.mjs | © Aureum, all rights reserved |
| `unmute.ogg` | you unmute | E5, dry and bright | synthesized, generate-sounds.mjs | © Aureum, all rights reserved |
| `deafen.ogg` | you deafen | E5 → B4, muffled | synthesized, generate-sounds.mjs | © Aureum, all rights reserved |
| `undeafen.ogg` | you undeafen | B4 → E5 | synthesized, generate-sounds.mjs | © Aureum, all rights reserved |
| `ptt-on.ogg` | push-to-talk pressed | B5, a short tick | synthesized, generate-sounds.mjs | © Aureum, all rights reserved |
| `ptt-off.ogg` | push-to-talk released | G#5, softer tick | synthesized, generate-sounds.mjs | © Aureum, all rights reserved |
| `message.ogg` | new DM or mention | E6 over a soft E5 | synthesized, generate-sounds.mjs | © Aureum, all rights reserved |
| `call-ringing.ogg` | incoming call (2.2 s loop) | E5 → B5 → E6 | synthesized, generate-sounds.mjs | © Aureum, all rights reserved |
| `call-outgoing.ogg` | you are calling someone (3 s loop) | E5, E5, soft | synthesized, generate-sounds.mjs | © Aureum, all rights reserved |
| `call-ended.ogg` | call declined or ended | E6 → B5 → E5 | synthesized, generate-sounds.mjs | © Aureum, all rights reserved |
| `screen-share.ogg` | a screen share starts | E5 → G#5 → B5 → E6 | synthesized, generate-sounds.mjs | © Aureum, all rights reserved |
