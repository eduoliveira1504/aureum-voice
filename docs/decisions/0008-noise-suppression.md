# 0008 — Microphone noise suppression with RNNoise

- **Status:** accepted
- **Date:** 2026-10-18

## Context

Playtests showed that the "noise suppression" setting did nothing noticeable. It only passed
`noiseSuppression: true` to `getUserMedia`, and Chromium's built-in filter barely touches keyboards or
fans. LiveKit's Krisp filter needs a paid LiveKit Cloud plan, and the project must cost nothing. It
also wouldn't work on the self-hosted server we're moving to.

## Decision

- The mic goes through **RNNoise** (Xiph's open-source neural denoiser, BSD-3-Clause) compiled to
  WebAssembly. It comes from `@sapphi-red/web-noise-suppressor` (MIT), which runs it in an AudioWorklet.
- It's a LiveKit **track processor** (`lib/noiseFilter.ts`). The processed track replaces the mic's in
  the sender, and the raw mic never leaves the PC. Everything runs locally, so it costs no bandwidth.
- It has its **own 48 kHz AudioContext**. RNNoise only works at 48 kHz, and the room's context runs at
  whatever rate the output device uses.
- It's **on by default**. The existing toggle in Configurações > Voz e vídeo adds or removes it during
  a call. The toggle stays per device (localStorage), like the device choices. Echo cancellation and
  auto gain stay on, and so does Chromium's own suppression, which runs before RNNoise.
- The packaged app loads from `file://`, where `fetch()` can't read files. So the `.wasm` is built into
  the bundle as base64 (a small `?base64` import plugin in `electron.vite.config.ts`), and only the
  worklet script is a separate file. The CSP gains `'wasm-unsafe-eval'`, which allows compiling
  WebAssembly and no JavaScript `eval`.
- Only the SIMD build ships. Electron always supports WASM SIMD.

## Consequences

- With synthetic noise in Electron, a fan-like noise (low-passed) dropped about 60 dB. Broadband noise
  needs a few seconds to adapt before it drops as much.
- The renderer bundle grows by about 210 KB (the base64 `.wasm`).
- If the filter fails to start, the mic keeps working with Chromium's suppression only. A warning goes
  to the console.
- RNNoise is trained for speech. Music played into the mic gets suppressed too. Screen share audio
  never goes through it.
