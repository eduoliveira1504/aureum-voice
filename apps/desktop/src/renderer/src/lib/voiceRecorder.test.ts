import { describe, expect, it } from 'vitest'

import { formatDuration, toWaveform } from './voiceRecorder'

describe('toWaveform', () => {
  it('squeezes the samples into bars relative to the loudest', () => {
    const bars = toWaveform([0.1, 0.1, 0.5, 0.5, 0.2, 0.2], 3)
    expect(bars).toEqual([20, 100, 40])
  })

  it('never gives more bars than samples, nor bars below the minimum', () => {
    expect(toWaveform([0.3, 0, 0.6])).toEqual([50, 4, 100])
    expect(toWaveform(new Array(1000).fill(0.2))).toHaveLength(64)
    expect(toWaveform([0, 0])).toEqual([4, 4])
    expect(toWaveform([])).toEqual([4])
  })
})

describe('formatDuration', () => {
  it('shows minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(4_200)).toBe('0:04')
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(300_000)).toBe('5:00')
  })
})
