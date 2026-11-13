/**
 * Cutting a sound in the app: the file is read here, the chosen stretch goes up as a mono 16-bit
 * 48 kHz WAV, and the original is never uploaded or kept. The API still checks 5 s and 1 MB.
 */

import { t } from './i18n'

export const MAX_SOURCE_BYTES = 10 * 1024 * 1024
export const MAX_SOURCE_SECONDS = 10 * 60
export const MAX_CLIP_SECONDS = 5
export const MIN_CLIP_SECONDS = 0.1
export const TRIM_RATE = 48000
const FADE_SECONDS = 0.01

export interface Selection {
  start: number
  end: number
}

/** A problem with the chosen file, in words for the person. */
export class SoundFileError extends Error {}

/** The first seconds of the sound, up to the maximum. */
export const firstClip = (duration: number): Selection => ({ start: 0, end: Math.min(duration, MAX_CLIP_SECONDS) })

/**
 * Moves one end of the selection to `to`. The other end follows when needed, so the selection
 * stays inside the sound and between MIN_CLIP_SECONDS and MAX_CLIP_SECONDS.
 */
export function moveEdge(sel: Selection, edge: 'start' | 'end', to: number, duration: number): Selection {
  const shortest = Math.min(MIN_CLIP_SECONDS, duration)
  if (edge === 'start') {
    const start = Math.min(Math.max(0, to), duration - shortest)
    const end = Math.min(Math.max(sel.end, start + shortest), start + MAX_CLIP_SECONDS, duration)
    return { start, end }
  }
  const end = Math.max(Math.min(duration, to), shortest)
  const start = Math.max(Math.min(sel.start, end - shortest), end - MAX_CLIP_SECONDS, 0)
  return { start, end }
}

/** "1:05.3" for a time in seconds. */
export function formatTime(seconds: number): string {
  const tenths = Math.round(seconds * 10)
  const minutes = Math.floor(tenths / 600)
  return `${minutes}:${((tenths - minutes * 600) / 10).toFixed(1).padStart(4, '0')}`
}

/** Reads "1:05.3", "65.3" or "65,3"; null if it isn't a time. */
export function parseTime(text: string): number | null {
  const match = /^(?:(\d+):)?(\d+(?:[.,]\d*)?)$/.exec(text.trim())
  if (!match) return null
  return Number(match[1] ?? 0) * 60 + Number(match[2].replace(',', '.'))
}

/** Checks the size, decodes at 48 kHz (Chromium converts) and checks the length. */
export async function decodeSoundFile(file: Blob): Promise<AudioBuffer> {
  if (file.size > MAX_SOURCE_BYTES) throw new SoundFileError(t('media.soundFile.tooBig'))
  const data = await file.arrayBuffer()
  const buffer = await new OfflineAudioContext(1, 1, TRIM_RATE).decodeAudioData(data).catch(() => {
    throw new SoundFileError(t('media.soundFile.unreadable'))
  })
  if (buffer.duration > MAX_SOURCE_SECONDS) throw new SoundFileError(t('media.soundFile.tooLong'))
  return buffer
}

/** All channels averaged into one. */
export function toMono(channels: Float32Array[]): Float32Array {
  const mono = new Float32Array(channels[0]?.length ?? 0)
  for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length
  return mono
}

/** The stretch of `samples`, with a short fade at both ends so it doesn't click. */
export function cutClip(samples: Float32Array, rate: number, { start, end }: Selection): Float32Array {
  const clip = samples.slice(Math.round(start * rate), Math.round(end * rate))
  const fade = Math.min(Math.round(FADE_SECONDS * rate), Math.floor(clip.length / 2))
  for (let i = 0; i < fade; i++) {
    const gain = i / fade
    clip[i] *= gain
    clip[clip.length - 1 - i] *= gain
  }
  return clip
}

/** 16-bit mono PCM in a WAV file. */
export function encodeWav(samples: Float32Array, rate: number): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const text = (at: number, value: string): void => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample))
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  })
  return new Blob([view.buffer], { type: 'audio/wav' })
}

/** The WAV to upload for the selection of `buffer`. */
export function clipWav(buffer: AudioBuffer, selection: Selection): Blob {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
  return encodeWav(cutClip(toMono(channels), buffer.sampleRate, selection), buffer.sampleRate)
}

/** Loudest level of each of `bars` equal slices of the view, 0..1, for the waveform. */
export function wavePeaks(samples: Float32Array, rate: number, from: number, to: number, bars: number): number[] {
  const first = Math.round(from * rate)
  const step = Math.max(1, ((to - from) * rate) / bars)
  return Array.from({ length: bars }, (_, bar) => {
    const begin = Math.floor(first + bar * step)
    const stop = Math.min(samples.length, Math.floor(first + (bar + 1) * step))
    // Long sounds: a sample of each slice is enough for the drawing.
    const hop = Math.max(1, Math.floor((stop - begin) / 200))
    let peak = 0
    for (let i = begin; i < stop; i += hop) peak = Math.max(peak, Math.abs(samples[i]))
    return Math.min(1, peak)
  })
}
