# 0020 — Mic pipeline: one channel, 48 kHz, one noise suppressor

- **Status:** accepted
- **Date:** 2026-10-20
- **Updates:** 0008 (the processor replaces `lib/noiseFilter.ts`, and Chromium's suppression is now off)

## Context

A beta tester's headset (Havit, Realtek chip) sounded thin and muffled, "in a tunnel", only in Aureum:
fine in Discord and WhatsApp. In the 0008 pipeline:

- Chromium's noise suppression ran, and RNNoise ran again on top of it.
- No sample rate or channel count was asked for. The RNNoise node took any number of channels but only
  processed the first, and the output was mixed down to mono: a stereo mic lost half its level.
- Some headset mics send two channels with one inverted or nearly silent. A plain downmix (L+R)/2 then
  cancels part of the voice, which is exactly that tunnel sound.

## Decision

- The mic is opened with `noiseSuppression: false` (RNNoise does that job), echo cancellation and auto
  gain on, and `sampleRate: { ideal: 48000 }`. **No channel count is forced.** Asking for mono makes the
  browser sum the channels, the very thing to avoid. This departs from the Phase 3 spec, which asked
  for `channelCount: 1`. Its other rule, "use one channel, never sum", wins.
- A track processor (`lib/micProcessor.ts`) is always on, with RNNoise only when the setting is on. It
  runs in its own 48 kHz AudioContext, and Chromium resamples any device rate into it:
  mic → **channel picker** (`lib/channelPicker.worklet.js`) → RNNoise → mono track.
- The channel picker keeps the louder channel by smoothed energy (~0.3 s) and only switches when the
  other one is about 3 dB stronger, so it doesn't flip on every syllable. It never mixes the channels.
- Every node is pinned with `channelCountMode: 'explicit'` and `channelInterpretation: 'discrete'`, so
  Web Audio never up- or down-mixes on its own.
- The worklet is emitted as a file (`?url&no-inline`). Inlined as a `data:` URL, the CSP
  (`script-src 'self'`) would block it.
- The logs get one `[mic]` line whenever the capture changes: the device name and what it actually
  delivers (`sampleRate`, `channelCount`, `echoCancellation`, `autoGainControl`, `noiseSuppression`).
  It comes from the source track's `getSettings()`, before the processor. "Reportar problema" attaches it.

## Consequences

- In Electron, a fake stereo mic with one channel inverted came out silent through a plain downmix, at
  48, 44.1 and 16 kHz. Through the picker it came out at full level at all three rates, the same as a
  normal stereo mic.
- With echo cancellation on, Chromium processes the capture in mono before the app sees it, so a
  stereo device may reach the picker already mixed. The `[mic]` log shows it (`channelCount=1`), and
  the per-feature switches in Configurações › Voz (next item of 3.2) let a tester confirm it.
- If the processor fails to start, the mic is sent as the device delivers it, without noise
  suppression. A warning goes to the console.
