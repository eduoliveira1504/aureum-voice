# 0035 — Painel de sons (soundboard)

- **Status:** accepted
- **Date:** 2026-10-25

## Context

Block 3.15: each server gets a "Painel de sons", short sounds that people in its voice rooms play
for the room. The spec asks for sounds that belong to one server only (no other server, no DMs),
at most 5 s, 1 MB, mp3/ogg/wav and 24 per server. Duration must be checked on the server with a new
dependency under a permissive license. The sound has to go out as its own LiveKit audio track,
never mixed into the mic (so it skips noise suppression). It needs SPEAK and is blocked by a server
mute. Other rules: one sound at a time per user, a 3 s cooldown, and per-person volume plus
"Silenciar sons dos outros". Eduardo added two rules before the build: the speaking ring (call,
overlay, lists) reacts only to the real mic, never to a sound, and the panel works with your own mic
muted but is off while you're deafened.

## Decision

### Storage and API

- Table `soundboard_sounds (server_id, name, emoji, volume 0–100, duration_ms, key, content_type,
  position, created_by)`, migration `c1e7a3b9d520`, which also adds
  `user_settings.soundboard_volume` / `soundboard_muted`.
- Uploads are recognized by their bytes (ID3 or an MPEG frame sync, `OggS`, `RIFF…WAVE`) and
  stored as uploaded in MinIO under `sounds/{server_id}/`. **tinytag** (2.3.2, MIT, pure Python, no
  dependencies) reads the length: mp3 (VBR too), Ogg Vorbis/Opus and wav. Up to 5.2 s is accepted,
  because encoders pad the end and a 5 s mp3 measures about 5.07 s. The measured length is kept,
  capped at 5 s. A file tinytag can't read, or that has no length, is refused with 415, and any
  parser error counts as "not audio", never a 500. ffprobe was the alternative and was turned down:
  about 80 MB more in the image and a process per upload.
- Permissions: `USE_SOUNDBOARD = 1 << 28` is on for @everyone, the migration turns it on for the
  @everyone role of every existing server, and it's a voice-room permission (stripped without
  CONNECT, settable per room). `MANAGE_SOUNDBOARD = 1 << 29` is server-wide. After these only
  `1 << 30` is left before the desktop's 32-bit math has to move to BigInt.
- `GET/POST /servers/{id}/sounds`, `PATCH/DELETE /sounds/{id}`, `GET /api/media/sounds/{id}`
  (members only, 404 otherwise) and the WS event `soundboard.updated`.
- `POST /sounds/{id}/play` is asked by the app right before it publishes the sound. It checks:
  the user is in one of **that** server's voice rooms (409 otherwise), they have SPEAK and
  USE_SOUNDBOARD there, they aren't deafened (by themselves or the server), and they aren't muted
  by the server. Their own mic mute doesn't matter. It then takes a per-user lock in Redis with
  `SET NX PX max(duration, 3000)`, which enforces both "one at a time" and the 3 s cooldown. A
  sound still holding the lock gets 429 with `Retry-After`.

### Playing in the call

- The sound is published as a **second audio track named `soundboard`**, only while it plays. It's
  built in Web Audio: decoded buffer → gain (the sound's volume) → MediaStreamDestination, with
  DTX and RED off. It never touches the mic pipeline (RNNoise, mic gain, push-to-talk). The person
  playing hears it locally through the same gain, scaled by their own soundboard volume.
- Its **source is `microphone`**. LiveKit's `canPublishSources` grant can't allow an "unknown"
  source, and the token always lists sources in server rooms, so any other source would be
  refused. This side effect is wanted: the track needs SPEAK, and a server mute (no mic source in
  the token, plus `MutePublishedTrack` on every mic-source track) stops it on the media server too.
- The cost: LiveKit's helpers (`getTrackPublication(Microphone)`, `isMicrophoneEnabled`,
  `setMicrophoneEnabled`) pick the *first* mic-source track. The app now finds the real mic by name
  (`micPublication`) for the mic processor, device moves and the muted mark on tiles. When a sound
  ends, it re-applies the mic state, in case LiveKit's toggle landed on the sound's track (someone
  who joined muted has no mic track yet).
- Playback stops at the length the server measured, even if the file says otherwise, so a file
  whose header lies can't play longer. Deafening, a server mute or deafen, or leaving the room
  also stops it.
- Listeners subscribe to `soundboard` tracks unless "Silenciar sons dos outros" is on, and play
  them at their soundboard volume × output volume. A person muted locally is muted in their sounds
  too; per-person volume doesn't apply to sounds.

### Speaking indicator

LiveKit's active speakers count every audio track of a participant, so a sound would light the
ring. For anyone who has a `soundboard` track out right now, the app ignores LiveKit's verdict and
measures that person's mic track itself: an AnalyserNode, RMS ≥ 0.016 (about −36 dBFS), polled
every 100 ms with a 400 ms hold. The analysers exist only while a sound is out (≤ 5 s). Everyone
else keeps LiveKit's speakers as before. The overlay, the call tiles, the lists and the floating
window all read the same `speaking` state, so the rule applies everywhere.

## Consequences

- Each sound renegotiates a track (publish, then unpublish), which adds a few hundred ms before
  others hear it. A track kept published and muted would start faster but would always sit in
  every subscriber's list. With sounds at most 5 s and 3 s apart, the delay is fine.
- LiveKit Cloud quota: a sound is at most 5 s of extra audio per listener, rate-limited by the
  lock. That's small next to the mics.
- Older apps (beta.6) don't know the track's name. They hear sounds as part of the person's
  audio, at that person's volume, and their speaking ring lights up for them. They can't play
  sounds (no button).
- Files are left in MinIO when a whole server is deleted (the same as stickers). The per-server
  prefix keeps a later cleanup easy.
