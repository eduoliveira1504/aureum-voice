/**
 * The mic's channel picker (channelPicker.worklet.js): one channel out, the louder one, never a
 * sum. Runs the worklet's code with stand-ins for the AudioWorklet globals.
 */

import { describe, expect, it } from 'vitest'

import code from './channelPicker.worklet.js?raw'

interface Picker {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}

function loadPicker(): Picker {
  let Processor: (new () => Picker) | undefined
  new Function('AudioWorkletProcessor', 'registerProcessor', code)(
    class {},
    (_name: string, cls: new () => Picker) => (Processor = cls)
  )
  return new Processor!()
}

const BLOCK = 128
const tone = (amplitude: number, phase = 1): Float32Array =>
  Float32Array.from({ length: BLOCK }, (_, i) => phase * amplitude * Math.sin((2 * Math.PI * 440 * i) / 48000))

/** Runs `blocks` blocks through the picker and returns the last output. */
function run(picker: Picker, input: Float32Array[], blocks = 200): Float32Array {
  const out = new Float32Array(BLOCK)
  for (let b = 0; b < blocks; b++) picker.process([input], [[out]])
  return out
}

describe('channel picker', () => {
  it('passes a mono mic through untouched', () => {
    const voice = tone(0.5)
    expect(run(loadPicker(), [voice])).toEqual(voice)
  })

  it('keeps one channel when the other is the same voice inverted (a sum would cancel it)', () => {
    const voice = tone(0.5)
    const out = run(loadPicker(), [voice, tone(0.5, -1)])
    expect(out).toEqual(voice)
  })

  it('uses the channel that has the voice when the first one is nearly silent', () => {
    const voice = tone(0.5)
    expect(run(loadPicker(), [tone(0.001), voice])).toEqual(voice)
  })

  it('does not flip between channels of similar level', () => {
    const picker = loadPicker()
    const left = tone(0.5)
    run(picker, [left, tone(0.6)])
    // 0.6 vs 0.5 is under the switch threshold: still the first channel.
    expect(run(picker, [left, tone(0.6)])).toEqual(left)
  })
})
