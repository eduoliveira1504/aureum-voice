#!/usr/bin/env node
/**
 * Generates Aureum's UI sounds by synthesis and encodes them to Ogg Vorbis with ffmpeg.
 *
 *   node scripts/generate-sounds.mjs          (or `npm run sounds` in apps/desktop)
 *   node scripts/generate-sounds.mjs message  (only the named sounds)
 *
 * Every sound is a few strikes of the same light "golden bell": additive synthesis with the
 * inharmonic partials of a small bell, where the upper partials die faster than the body, so
 * each strike starts metallic and settles warm. All notes come from E major (E, G#, B) so the
 * set sounds like one family. To tweak a sound, edit its entry in SOUNDS and run again.
 *
 * Requires ffmpeg on PATH (Windows: `winget install ffmpeg`).
 * © Aureum. All rights reserved. See docs/sounds/LICENSES.md.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'apps/desktop/src/renderer/src/assets/sounds')
const RATE = 48000
const PEAK = 0.708 // -3 dBFS, before each sound's own level

const NOTE = {
  B4: 493.88,
  E5: 659.26,
  'G#5': 830.61,
  B5: 987.77,
  E6: 1318.51
}

/**
 * The bell: [frequency ratio, amplitude, decay multiplier]. Ratios 2.76 / 5.40 / 8.93 are the
 * classic inharmonic bell modes; `bright` scales everything above the octave.
 */
const PARTIALS = [
  [1.0, 1.0, 1.0],
  [2.0, 0.42, 0.62],
  [2.76, 0.3, 0.42],
  [5.4, 0.14, 0.26],
  [8.93, 0.07, 0.16]
]
const SHIMMER_HZ = 1.6 // a detuned twin of the fundamental, so the tail gently beats
const TINK = { ratio: 13.3, amp: 0.05, decay: 0.03 } // the metallic "strike" right at the attack
const ATTACK = 0.004

/**
 * Each sound: strikes `[note, start s, options]` with options
 *   decay  seconds until the fundamental is 60 dB down (default 0.6)
 *   bright 0..1, how much of the upper partials and the strike come through (default 0.7)
 *   gain   relative loudness of this strike (default 1)
 * `level` sets the whole sound against the others; `loop` renders a seamless loop of that length.
 */
const SOUNDS = {
  'call-join': { level: 0.9, strikes: [['E5', 0, { decay: 0.6, bright: 0.8 }], ['B5', 0.11, { decay: 0.7, bright: 0.8 }]] },
  'call-leave': { level: 0.85, strikes: [['B5', 0, { decay: 0.55, bright: 0.45 }], ['E5', 0.11, { decay: 0.65, bright: 0.4 }]] },
  'user-join': { level: 0.6, strikes: [['G#5', 0, { decay: 0.4, bright: 0.6, gain: 0.85 }], ['B5', 0.09, { decay: 0.45, bright: 0.6 }]] },
  'user-leave': { level: 0.55, strikes: [['B5', 0, { decay: 0.4, bright: 0.4, gain: 0.85 }], ['G#5', 0.09, { decay: 0.45, bright: 0.35 }]] },
  mute: { level: 0.7, strikes: [['B4', 0, { decay: 0.14, bright: 0.15 }]] },
  unmute: { level: 0.7, strikes: [['E5', 0, { decay: 0.16, bright: 0.7 }]] },
  deafen: { level: 0.7, strikes: [['E5', 0, { decay: 0.2, bright: 0.2 }], ['B4', 0.08, { decay: 0.25, bright: 0.12 }]] },
  undeafen: { level: 0.7, strikes: [['B4', 0, { decay: 0.2, bright: 0.4 }], ['E5', 0.08, { decay: 0.25, bright: 0.7 }]] },
  // Push-to-talk: a tiny tick on press and a softer one on release (they repeat a lot).
  'ptt-on': { level: 0.4, strikes: [['B5', 0, { decay: 0.07, bright: 0.55 }]] },
  'ptt-off': { level: 0.35, strikes: [['G#5', 0, { decay: 0.07, bright: 0.25 }]] },
  message: { level: 0.75, strikes: [['E6', 0, { decay: 0.5, bright: 0.9 }], ['E5', 0, { decay: 0.35, bright: 0.3, gain: 0.35 }]] },
  'call-ringing': {
    level: 0.9,
    loop: 2.2,
    strikes: [['E5', 0, { decay: 0.9, bright: 0.8 }], ['B5', 0.16, { decay: 0.9, bright: 0.8 }], ['E6', 0.32, { decay: 1.0, bright: 0.85 }]]
  },
  'call-outgoing': {
    level: 0.6,
    loop: 3.0,
    strikes: [['E5', 0, { decay: 0.8, bright: 0.3, gain: 0.8 }], ['E5', 0.42, { decay: 1.1, bright: 0.35 }]]
  },
  'call-ended': {
    level: 0.8,
    strikes: [['E6', 0, { decay: 0.35, bright: 0.7 }], ['B5', 0.1, { decay: 0.4, bright: 0.5 }], ['E5', 0.2, { decay: 0.55, bright: 0.3 }]]
  },
  'screen-share': {
    level: 0.75,
    strikes: [
      ['E5', 0, { decay: 0.5, bright: 0.85, gain: 0.8 }],
      ['G#5', 0.06, { decay: 0.5, bright: 0.85, gain: 0.85 }],
      ['B5', 0.12, { decay: 0.55, bright: 0.9, gain: 0.9 }],
      ['E6', 0.18, { decay: 0.8, bright: 0.95 }]
    ]
  }
}

/** Adds one bell strike into `buf` (wrapping around the end when the sound loops). */
function strike(buf, frequency, start, { decay = 0.6, bright = 0.7, gain = 1 }, wrap) {
  const tau = decay / Math.log(1000)
  const length = Math.ceil(decay * RATE)
  const offset = Math.round(start * RATE)
  const voices = PARTIALS.map(([ratio, amp, decayMul], i) => ({
    freq: frequency * ratio,
    amp: amp * (i >= 2 ? bright : 1),
    tau: tau * decayMul
  }))
  voices.push({ freq: frequency + SHIMMER_HZ, amp: 0.35, tau })
  voices.push({ freq: frequency * TINK.ratio, amp: TINK.amp * bright, tau: TINK.decay })
  for (let n = 0; n < length; n++) {
    const t = n / RATE
    const attack = t < ATTACK ? 0.5 - 0.5 * Math.cos((Math.PI * t) / ATTACK) : 1
    let sample = 0
    for (const v of voices) {
      if (v.freq >= RATE / 2) continue
      sample += v.amp * Math.exp(-t / v.tau) * Math.sin(2 * Math.PI * v.freq * t)
    }
    const index = offset + n
    if (index < buf.length) buf[index] += gain * attack * sample
    else if (wrap) buf[index % buf.length] += gain * attack * sample
  }
}

function render({ strikes, level, loop }) {
  const end = loop ?? Math.max(...strikes.map(([, start, o]) => start + (o.decay ?? 0.6))) + 0.02
  const buf = new Float32Array(Math.ceil(end * RATE))
  for (const [note, start, options] of strikes) strike(buf, NOTE[note], start, options, Boolean(loop))
  if (!loop) {
    const fade = Math.round(0.02 * RATE) // the last 20 ms go to silence, so the end never clicks
    for (let i = 0; i < fade; i++) buf[buf.length - 1 - i] *= i / fade
  }
  let peak = 0
  for (const s of buf) peak = Math.max(peak, Math.abs(s))
  const scale = (PEAK * level) / peak
  for (let i = 0; i < buf.length; i++) buf[i] *= scale
  return buf
}

function encode(name, samples) {
  const file = join(OUT_DIR, `${name}.ogg`)
  // bitexact keeps the output byte-identical between runs, so regenerating only shows up in git
  // when a sound actually changed.
  const args = [
    ...['-hide_banner', '-loglevel', 'error', '-y'],
    ...['-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', 'pipe:0'],
    ...['-c:a', 'libvorbis', '-q:a', '5', '-fflags', '+bitexact', '-flags:a', '+bitexact'],
    ...['-metadata', `title=Aureum ${name}`, '-metadata', 'copyright=© Aureum. All rights reserved.'],
    file
  ]
  const result = spawnSync('ffmpeg', args, { input: Buffer.from(samples.buffer) })
  if (result.error?.code === 'ENOENT') {
    console.error('ffmpeg not found on PATH. On Windows: winget install ffmpeg')
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`ffmpeg failed for ${name}:\n${result.stderr}`)
    process.exit(1)
  }
  return file
}

const only = process.argv.slice(2)
const unknown = only.filter((name) => !(name in SOUNDS))
if (unknown.length) {
  console.error(`Unknown sound(s): ${unknown.join(', ')}. Known: ${Object.keys(SOUNDS).join(', ')}`)
  process.exit(1)
}
mkdirSync(OUT_DIR, { recursive: true })
for (const [name, sound] of Object.entries(SOUNDS)) {
  if (only.length && !only.includes(name)) continue
  const samples = render(sound)
  encode(name, samples)
  const seconds = (samples.length / RATE).toFixed(2)
  console.log(`${name.padEnd(14)} ${seconds} s${sound.loop ? ' (loop)' : ''}`)
}
