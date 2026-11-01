import { describe, expect, it } from 'vitest'

import {
  cutClip,
  decodeSoundFile,
  encodeWav,
  firstClip,
  formatTime,
  MAX_CLIP_SECONDS,
  MAX_SOURCE_BYTES,
  moveEdge,
  parseTime,
  toMono,
  wavePeaks
} from './soundTrim'

const seconds = (s: { start: number; end: number }): number => s.end - s.start

describe('the selection', () => {
  it('starts on the first 5 seconds, or the whole of a shorter sound', () => {
    expect(firstClip(120)).toEqual({ start: 0, end: 5 })
    expect(firstClip(3)).toEqual({ start: 0, end: 3 })
  })

  it('never passes 5 seconds: the other end follows', () => {
    expect(moveEdge({ start: 0, end: 5 }, 'end', 30, 120)).toEqual({ start: 25, end: 30 })
    expect(moveEdge({ start: 25, end: 30 }, 'start', 2, 120)).toEqual({ start: 2, end: 7 })
    for (const to of [-5, 0, 3, 60, 119, 500]) {
      for (const edge of ['start', 'end'] as const) {
        expect(seconds(moveEdge({ start: 10, end: 15 }, edge, to, 120))).toBeLessThanOrEqual(MAX_CLIP_SECONDS)
      }
    }
  })

  it('stays inside the sound and never collapses', () => {
    expect(moveEdge({ start: 10, end: 12 }, 'end', 500, 20)).toEqual({ start: 15, end: 20 })
    expect(moveEdge({ start: 10, end: 12 }, 'start', -3, 20)).toEqual({ start: 0, end: 5 })
    expect(seconds(moveEdge({ start: 10, end: 12 }, 'start', 12, 20))).toBeCloseTo(0.1)
    expect(seconds(moveEdge({ start: 10, end: 12 }, 'end', 10, 20))).toBeCloseTo(0.1)
  })
})

describe('typed times', () => {
  it('reads and writes minutes and tenths', () => {
    expect(formatTime(65.3)).toBe('1:05.3')
    expect(formatTime(4)).toBe('0:04.0')
    expect(formatTime(59.97)).toBe('1:00.0')
    expect(parseTime('1:05.3')).toBeCloseTo(65.3)
    expect(parseTime('65,3')).toBeCloseTo(65.3)
    expect(parseTime('abc')).toBeNull()
  })
})

describe('the clip', () => {
  const rate = 48000

  it('comes out as a mono 48 kHz WAV of the chosen length', async () => {
    const samples = new Float32Array(rate * 60).fill(0.5)
    const blob = encodeWav(cutClip(samples, rate, { start: 10, end: 13.5 }), rate)
    const view = new DataView(await blob.arrayBuffer())
    expect(blob.type).toBe('audio/wav')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(rate)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true) / 2 / rate).toBeCloseTo(3.5)
  })

  it('fits the API: 5 s stay under 1 MB', () => {
    expect(encodeWav(new Float32Array(rate * 5), rate).size).toBeLessThan(500 * 1024)
  })

  it('fades both ends', () => {
    const clip = cutClip(new Float32Array(rate).fill(1), rate, { start: 0, end: 1 })
    expect(clip[0]).toBe(0)
    expect(clip[clip.length - 1]).toBe(0)
    expect(clip[rate / 2]).toBe(1)
  })

  it('mixes channels into one', () => {
    expect([...toMono([new Float32Array([1, 0]), new Float32Array([0, 0])])]).toEqual([0.5, 0])
  })

  it('draws one peak per bar', () => {
    const peaks = wavePeaks(new Float32Array([0, 0.5, 0, -1]), 4, 0, 1, 2)
    expect(peaks).toEqual([0.5, 1])
  })
})

describe('the file', () => {
  it('refuses one that is too big, in words', async () => {
    const big = { size: MAX_SOURCE_BYTES + 1 } as Blob
    await expect(decodeSoundFile(big)).rejects.toThrow('O arquivo pode ter até 10 MB.')
  })

  it('refuses one that does not decode, in words', async () => {
    const fake = class {
      decodeAudioData = (): Promise<never> => Promise.reject(new Error('EncodingError'))
    }
    Object.assign(globalThis, { OfflineAudioContext: fake })
    await expect(decodeSoundFile(new Blob(['nope']))).rejects.toThrow('Não deu para ler esse áudio.')
  })

  it('refuses a sound over 10 minutes', async () => {
    const fake = class {
      decodeAudioData = async (): Promise<{ duration: number }> => ({ duration: 601 })
    }
    Object.assign(globalThis, { OfflineAudioContext: fake })
    await expect(decodeSoundFile(new Blob(['x']))).rejects.toThrow('O áudio pode ter até 10 minutos.')
  })
})
