import { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
// Inlined: the packaged app loads from file://, where fetch() can't read files. Electron always
// supports WASM SIMD, so the plain build isn't needed.
import wasmBase64 from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?base64'
import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'

// A file, never an inlined data: URL: the app's CSP (script-src 'self') would block that.
import pickerUrl from './channelPicker.worklet.js?url&no-inline'
import gateUrl from './voiceGate.worklet.js?url&no-inline'

export const MIC_PROCESSOR = 'aureum-mic'
/** RNNoise only works at 48 kHz. */
export const PROCESSING_RATE = 48000

/** dBFS of a linear RMS level (floored at -100). */
export const toDb = (rms: number): number => (rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100)
const fromDb = (db: number): number => 10 ** (db / 20)

/** The level the voice gate receives (dBFS, after noise suppression) and whether it's open. */
export type LevelListener = (db: number, open: boolean) => void

let wasm: ArrayBuffer | undefined

function wasmBinary(): ArrayBuffer {
  wasm ??= Uint8Array.from(atob(wasmBase64), (c) => c.charCodeAt(0)).buffer
  return wasm
}

/**
 * What runs on the mic before it's sent (a LiveKit track processor), in its own 48 kHz
 * AudioContext (the room's runs at the output device's rate):
 *
 *   mic (any rate, 1 or 2 channels) → resampled to 48 kHz by the AudioContext
 *     → channel picker (one channel, the louder; never a sum, see channelPicker.worklet.js)
 *     → RNNoise noise suppression, when on (free and open source, unlike LiveKit Cloud's Krisp)
 *     → voice gate (manual sensitivity; open when it's automatic, see voiceGate.worklet.js)
 *     → mono track
 *
 * Each node is pinned to its channel count ('explicit' + 'discrete'), so Web Audio never mixes
 * channels on its own. The mic test in Configurações › Voz runs this same class, so what you hear
 * there is what the others hear.
 */
export class MicProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = MIC_PROCESSOR
  processedTrack?: MediaStreamTrack
  private ctx?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private picker?: AudioWorkletNode
  private rnnoise?: RnnoiseWorkletNode
  private gate?: AudioWorkletNode
  private listener: LevelListener | null = null

  /** `gateDb`: the manual sensitivity threshold in dBFS, or null for automatic (no gate). */
  constructor(
    readonly denoise: boolean,
    private gateDb: number | null = null
  ) {}

  /** Changes the sensitivity live, without restarting the mic. */
  setGate(db: number | null): void {
    this.gateDb = db
    this.gate?.port.postMessage({ threshold: db === null ? 0 : fromDb(db) })
  }

  /** Reports the level ~20 times a second to `listener` (null stops it). */
  onLevel(listener: LevelListener | null): void {
    this.listener = listener
    this.gate?.port.postMessage({ report: listener !== null })
  }

  async init({ track }: AudioProcessorOptions): Promise<void> {
    const ctx = new AudioContext({ sampleRate: PROCESSING_RATE, latencyHint: 'interactive' })
    this.ctx = ctx
    try {
      if (ctx.sampleRate !== PROCESSING_RATE) throw new Error(`AudioContext runs at ${ctx.sampleRate} Hz`)
      await ctx.audioWorklet.addModule(pickerUrl)
      await ctx.audioWorklet.addModule(gateUrl)
      if (this.denoise) await ctx.audioWorklet.addModule(workletUrl)

      const source = ctx.createMediaStreamSource(new MediaStream([track]))
      const picker = new AudioWorkletNode(ctx, 'aureum-channel-picker', {
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
        outputChannelCount: [1]
      })
      const destination = ctx.createMediaStreamDestination()
      destination.channelCount = 1
      destination.channelCountMode = 'explicit'
      destination.channelInterpretation = 'discrete'

      let last: AudioNode = source.connect(picker)
      if (this.denoise) {
        const rnnoise = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: wasmBinary() })
        rnnoise.channelCount = 1
        rnnoise.channelCountMode = 'explicit'
        rnnoise.channelInterpretation = 'discrete'
        last = last.connect(rnnoise)
        this.rnnoise = rnnoise
      }
      const gate = new AudioWorkletNode(ctx, 'aureum-voice-gate', {
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
        outputChannelCount: [1]
      })
      gate.port.onmessage = ({ data }: MessageEvent<{ level: number; open: boolean }>) =>
        this.listener?.(toDb(data.level), data.open)
      last.connect(gate).connect(destination)
      this.source = source
      this.picker = picker
      this.gate = gate
      this.setGate(this.gateDb)
      this.onLevel(this.listener)
      this.processedTrack = destination.stream.getAudioTracks()[0]
      if (ctx.state === 'suspended') await ctx.resume()
    } catch (err) {
      await this.destroy()
      throw err
    }
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy()
    await this.init(opts)
  }

  async destroy(): Promise<void> {
    this.source?.disconnect()
    this.picker?.disconnect()
    this.rnnoise?.destroy()
    this.gate?.disconnect()
    this.processedTrack?.stop()
    await this.ctx?.close().catch(() => {})
    this.source = this.picker = this.rnnoise = this.gate = this.processedTrack = this.ctx = undefined
  }
}
