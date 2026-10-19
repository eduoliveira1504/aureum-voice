/**
 * Voice messages: records the mic as Opus/WebM (MediaRecorder) and measures the loudness while
 * it goes, so the message carries a waveform and its duration (the player draws them without
 * decoding the file). Up to 5 minutes; it stops by itself at the limit.
 */

import { loadMediaPrefs } from './mediaPrefs'

export const MAX_VOICE_MS = 5 * 60 * 1000
export const WAVEFORM_BARS = 64
const MIME = 'audio/webm;codecs=opus'
const SAMPLE_MS = 50

export interface Recording {
  blob: Blob
  durationMs: number
  /** Bar heights, 0-100. */
  waveform: number[]
}

/**
 * Loudness samples (0-1) squeezed into up to `bars` bars of 0-100, relative to the loudest one
 * so quiet recordings still show their shape. Every bar keeps a small minimum, so silence shows
 * as a flat line instead of nothing.
 */
export function toWaveform(levels: number[], bars = WAVEFORM_BARS): number[] {
  if (!levels.length) return [4]
  const count = Math.min(bars, levels.length)
  const buckets = Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i * levels.length) / count)
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / count))
    const slice = levels.slice(from, to)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
  const peak = Math.max(...buckets)
  return buckets.map((v) => (peak > 0 ? Math.max(4, Math.round((v / peak) * 100)) : 4))
}

/** "1:05" */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export class VoiceRecorder {
  private readonly chunks: Blob[] = []
  private readonly levels: number[] = []
  private readonly startedAt = performance.now()
  private readonly timer: ReturnType<typeof setInterval>
  private readonly context: AudioContext
  private finished = false

  /** Every ~50 ms while recording: time so far and the current loudness (0-1). */
  onTick: (elapsedMs: number, level: number) => void = () => {}
  /** Reached 5 minutes (the recording already stopped growing; call stop() to get it). */
  onLimit: () => void = () => {}

  private constructor(
    private readonly stream: MediaStream,
    private readonly recorder: MediaRecorder
  ) {
    recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
    this.context = new AudioContext()
    const analyser = this.context.createAnalyser()
    analyser.fftSize = 1024
    this.context.createMediaStreamSource(stream).connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    this.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples)
      const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length)
      const level = Math.min(1, rms * 4)
      this.levels.push(level)
      const elapsed = this.elapsed()
      this.onTick(elapsed, level)
      if (elapsed >= MAX_VOICE_MS && recorder.state === 'recording') {
        recorder.pause()
        this.onLimit()
      }
    }, SAMPLE_MS)
    recorder.start(1000)
  }

  /** Opens the mic chosen in Settings and starts recording. Rejects without mic access. */
  static async start(): Promise<VoiceRecorder> {
    const deviceId = loadMediaPrefs().audioInput || undefined
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    try {
      return new VoiceRecorder(stream, new MediaRecorder(stream, { mimeType: MIME, audioBitsPerSecond: 32_000 }))
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop())
      throw err
    }
  }

  elapsed(): number {
    return Math.min(MAX_VOICE_MS, performance.now() - this.startedAt)
  }

  /** Stops and returns the recording. */
  stop(): Promise<Recording> {
    const durationMs = Math.round(this.elapsed())
    return new Promise((resolve) => {
      this.recorder.onstop = () => {
        this.release()
        resolve({ blob: new Blob(this.chunks, { type: 'audio/webm' }), durationMs, waveform: toWaveform(this.levels) })
      }
      if (this.recorder.state === 'inactive') this.recorder.onstop(new Event('stop'))
      else this.recorder.stop()
    })
  }

  /** Stops and throws the recording away. */
  cancel(): void {
    this.recorder.onstop = null
    if (this.recorder.state !== 'inactive') this.recorder.stop()
    this.release()
  }

  private release(): void {
    if (this.finished) return
    this.finished = true
    clearInterval(this.timer)
    this.stream.getTracks().forEach((t) => t.stop())
    void this.context.close()
  }
}
