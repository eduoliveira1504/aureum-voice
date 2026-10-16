# 0002 — Screen share system audio without echo

- **Status:** accepted
- **Date:** 2026-10-16

## Context

Sharing a screen "with game sound" means capturing system audio. On Windows, Electron
does this with `setDisplayMediaRequestHandler` returning `audio: 'loopback'`, which captures
everything the PC plays — including the call itself. The people in the call would then hear
their own voices echoed back through the screen share.

Electron's API has no option to exclude the app's own audio (only `loopback` and
`loopbackWithMute`, which mutes the sharer's speakers).

## Experiment

Inside the app, with system audio shared and a 1 kHz tone played by the app itself:

| Capture constraints        | App's own tone in capture | Other apps' audio in capture |
|----------------------------|---------------------------|------------------------------|
| `audio: true`              | present (−40 dB)          | present                      |
| `{ restrictOwnAudio: true }` | **absent**              | **present**                  |

With `restrictOwnAudio`, Chromium switches the loopback device to `loopbackWithoutChrome`
(a Windows process-loopback mode that excludes the app's process tree). An end-to-end test
with two app instances and real devices confirmed it through LiveKit: another app's tone
arrived +52 dB above the noise floor, while the app's own tone stayed at the floor (+1 dB).

## Decision

The renderer calls `getDisplayMedia` itself with `restrictOwnAudio: true` and with echo
cancellation, noise suppression and auto gain **off** (game audio must not be processed like
a microphone), in stereo. The tracks are then published to LiveKit as `ScreenShare` and
`ScreenShareAudio` with a high-quality stereo music preset (no DTX/RED).

## Consequences

- Game and media audio reach viewers; the call's voices do not loop back.
- System audio is the whole PC minus this app: music or notifications the sharer hears
  are shared too (same as Discord's "share entire screen" audio on Windows).
- Depends on Windows 10 2004+ process loopback support; elsewhere the share has no audio.
