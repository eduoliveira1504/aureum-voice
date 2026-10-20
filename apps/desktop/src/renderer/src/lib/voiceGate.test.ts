/** The voice gate (voiceGate.worklet.js): manual sensitivity and the level reports for the meter. */

import { describe, expect, it } from 'vitest'

import code from './voiceGate.worklet.js?raw'

interface Gate {
  port: { onmessage: (e: { data: unknown }) => void; postMessage(data: unknown): void }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}

const RATE = 48000
const BLOCK = 128

function loadGate(): { gate: Gate; sent: unknown[] } {
  const sent: unknown[] = []
  let Processor: (new () => Gate) | undefined
  class Base {
    port = { onmessage: (_e: { data: unknown }) => {}, postMessage: (data: unknown) => sent.push(data) }
  }
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', code)(
    Base,
    (_name: string, cls: new () => Gate) => (Processor = cls),
    RATE
  )
  return { gate: new Processor!(), sent }
}

const tone = (amplitude: number): Float32Array =>
  Float32Array.from({ length: BLOCK }, (_, i) => amplitude * Math.sin((2 * Math.PI * 440 * i) / RATE))
const rms = (a: Float32Array): number => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length)

/** Runs `seconds` of the same block through the gate; returns the last output. */
function run(gate: Gate, input: Float32Array, seconds: number): Float32Array {
  const out = new Float32Array(BLOCK)
  for (let n = 0; n < Math.ceil((seconds * RATE) / BLOCK); n++) gate.process([[input]], [[out]])
  return out
}

const threshold = (db: number): { data: { threshold: number } } => ({ data: { threshold: 10 ** (db / 20) } })

describe('voice gate', () => {
  it('lets everything through with automatic sensitivity', () => {
    const { gate } = loadGate()
    const quiet = tone(0.001)
    expect(run(gate, quiet, 1)).toEqual(quiet)
  })

  it('silences sound below the threshold once the hold time is over', () => {
    const { gate } = loadGate()
    gate.port.onmessage(threshold(-40)) // ≈ 0.01 RMS
    expect(rms(run(gate, tone(0.005), 0.1))).toBeGreaterThan(0) // still holding
    expect(rms(run(gate, tone(0.005), 0.5))).toBe(0)
  })

  it('opens right away for a voice above the threshold', () => {
    const { gate } = loadGate()
    gate.port.onmessage(threshold(-40))
    run(gate, tone(0.005), 1)
    const voice = tone(0.3)
    const out = run(gate, voice, 0.02) // ~7 blocks: past the 5 ms attack
    expect(out).toEqual(voice)
  })

  it('reports the level it receives about 20 times a second, only when asked', () => {
    const { gate, sent } = loadGate()
    run(gate, tone(0.3), 1)
    expect(sent).toHaveLength(0)
    gate.port.onmessage({ data: { report: true } })
    run(gate, tone(0.3), 1)
    expect(sent.length).toBeGreaterThanOrEqual(19)
    expect(sent.length).toBeLessThanOrEqual(21)
    const { level, open } = sent.at(-1) as { level: number; open: boolean }
    // A tone's RMS is amplitude/√2; a 128-sample block isn't a whole number of periods, so ±10%.
    expect(level).toBeGreaterThan((0.3 / Math.SQRT2) * 0.9)
    expect(level).toBeLessThan((0.3 / Math.SQRT2) * 1.1)
    expect(open).toBe(true)
  })
})
