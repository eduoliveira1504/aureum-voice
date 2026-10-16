import { loadMediaPrefs } from './mediaPrefs'

/**
 * Ringtone for incoming calls: a short rising three-note chime, repeated. It's synthesized with
 * Web Audio, so there's no audio file (and no license to track); block 2.6 brings the full sound
 * set and its settings.
 */

const NOTES: [frequency: number, offset: number][] = [
  [659.25, 0], // E5
  [987.77, 0.16], // B5
  [1318.51, 0.32] // E6
]
const REPEAT_MS = 2200

let context: AudioContext | null = null

function chime(ctx: AudioContext, volume: number): void {
  const now = ctx.currentTime
  const master = ctx.createGain()
  master.gain.value = 0.22 * volume
  master.connect(ctx.destination)
  for (const [frequency, offset] of NOTES) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = frequency
    const env = ctx.createGain()
    env.gain.setValueAtTime(0, now + offset)
    env.gain.linearRampToValueAtTime(1, now + offset + 0.015)
    env.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.7)
    osc.connect(env).connect(master)
    osc.start(now + offset)
    osc.stop(now + offset + 0.75)
  }
}

/** Starts ringing at `volume` (0..1) on the chosen speakers; returns the stop function. */
export function startRingtone(volume: number): () => void {
  if (volume <= 0) return () => {}
  context ??= new AudioContext()
  const ctx = context
  const output = loadMediaPrefs().audioOutput
  const sink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
  if (output) sink.setSinkId?.(output).catch(() => {})
  void ctx.resume()
  chime(ctx, volume)
  const timer = setInterval(() => chime(ctx, volume), REPEAT_MS)
  return () => clearInterval(timer)
}
