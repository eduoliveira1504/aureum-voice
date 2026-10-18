# 0011 — UI sounds and when they play

- **Status:** accepted
- **Date:** 2026-10-18

## Context

Block 2.6 adds sounds for calls, messages and screen shares. They can't come from Discord or any
other app. They are part of Aureum's identity, so they shouldn't come from a public sound pack
either. They also must not get in the way: a message chime over a call, or ringing while the user
asked not to be disturbed, is noise.

## Decision

**The sounds themselves**
- All 13 sounds are synthesized by `scripts/generate-sounds.mjs`. It uses additive synthesis of a
  light bell (inharmonic partials, where the upper ones fade first), and every note comes from E major,
  so the set sounds like one family. ffmpeg encodes the output to Ogg Vorbis. The output is
  byte-identical between runs, so regenerating only changes the files whose sound changed.
- The sounds are **© Aureum, all rights reserved**, not CC0 (see `docs/sounds/LICENSES.md`). ffmpeg is
  needed only to regenerate them, because the `.ogg` files are committed.
- The incoming ring (E5 → B5 → E6) and the outgoing ring (two soft E5 strikes) are deliberately
  different, so it's always clear who is calling whom.

**Playback**
- `lib/sounds.ts` plays the sounds through one Web Audio context on the speakers chosen in Voz e vídeo.
  As with the RNNoise `.wasm` (0008), the files are built into the bundle as base64, because `fetch()`
  can't read `file://` in the packaged app. They add about 155 KB.
- Settings live in the existing `user_settings.sounds`: a volume, plus an on/off switch per event,
  keyed by the file name with dots (`call-join` → `call.join`). Events missing from the map are on, so
  sounds added later start enabled. The API didn't need to change.

**When they play**
- Messages: the sound plays for DMs and groups unless the conversation is silenced, and for mentions
  anywhere. It doesn't play for the conversation on screen while the app has focus, nor for a call's
  own line in the chat (the ringtone covers that). During a call it plays at 40% volume, and not at all
  for the chat of the call the user is in.
- Joining or leaving the user's own call, mute, deafen and the screen share use LiveKit room events.
  Switching rooms is silent, and so is signing out.
- If the user is calling and nobody has joined yet, the outgoing ring loops. If everyone declines or
  the ring times out, the call hangs up with `call-ended`. A caller who hangs up before the user
  answers also plays `call-ended`.
- **Do not disturb** silences the sounds other people cause: message, call-ringing, user-join,
  user-leave and screen-share from others. An incoming call opens no popup. It shows only a small
  "Chamada perdida" note for 10 s, and the Home badge counts it as usual, because the call leaves an
  unread line in its conversation. Sounds from the user's own actions (join, leave, outgoing ring,
  mute, unmute, deafen, undeafen, call ended) keep playing, because they confirm what the user did.
  Each one can still be switched off in Configurações > Sons.

## Consequences

- Changing a sound means editing its entry in the script and running `npm run sounds`. There's no
  sound editor or audio tooling beyond ffmpeg.
- If a call comes in during Do not disturb, the server still rings the user for 30 s. The callee just
  doesn't hear or see it, so to the caller it looks the same as "no answer".
- A new sound needs its `.ogg`, a `SoundName`, a label in `SoundSettings.tsx`, and a place in
  `OWN_SOUNDS` or `OTHERS_SOUNDS`.
