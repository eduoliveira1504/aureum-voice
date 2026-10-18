import { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
// Inlined: the packaged app loads from file://, where fetch() can't read files. Electron always
// supports WASM SIMD, so the plain build isn't needed.
import wasmBase64 from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?base64'
import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'

export const NOISE_FILTER = 'aureum-rnnoise'

let wasm: ArrayBuffer | undefined

function wasmBinary(): ArrayBuffer {
  wasm ??= Uint8Array.from(atob(wasmBase64), (c) => c.charCodeAt(0)).buffer
  return wasm
}

/**
 * Noise suppression with RNNoise, run locally on the mic before it's sent (a LiveKit track
 * processor). Free and open source, unlike LiveKit Cloud's Krisp filter.
 *
 * It uses its own 48 kHz AudioContext: RNNoise only works at that rate, and the room's context
 * runs at whatever the output device uses.
 */
export class NoiseFilter implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = NOISE_FILTER
  processedTrack?: MediaStreamTrack
  private ctx?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private node?: RnnoiseWorkletNode

  async init({ track }: AudioProcessorOptions): Promise<void> {
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
    this.ctx = ctx
    try {
      await ctx.audioWorklet.addModule(workletUrl)
      const source = ctx.createMediaStreamSource(new MediaStream([track]))
      const node = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: wasmBinary() })
      const destination = ctx.createMediaStreamDestination()
      destination.channelCount = 1
      source.connect(node).connect(destination)
      this.source = source
      this.node = node
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
    this.node?.destroy()
    this.processedTrack?.stop()
    await this.ctx?.close().catch(() => {})
    this.source = this.node = this.processedTrack = this.ctx = undefined
  }
}
