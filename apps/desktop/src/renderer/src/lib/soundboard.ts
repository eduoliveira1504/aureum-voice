/**
 * Painel de sons inside a call (see docs/decisions/0035-soundboard.md).
 *
 * A sound goes out as a second audio track, published only while it plays and named
 * SOUNDBOARD_TRACK. Its source is "microphone" because a room token that limits sources can't
 * allow any other kind of extra track; that also means it needs SPEAK and a server mute stops it.
 * It never goes through the mic: no RNNoise, no mic gain, no push-to-talk.
 *
 * Because LiveKit's own helpers pick "the first microphone track", everything here that means the
 * real mic goes through micPublication(), and LiveKit's active speakers (which count every audio
 * track) are not trusted for someone with a sound playing: MicLevels measures their mic alone.
 */

import { AudioPresets, Track, type LocalParticipant, type Participant, type Room, type TrackPublication } from 'livekit-client'

import { loadMediaPrefs } from './mediaPrefs'

export const SOUNDBOARD_TRACK = 'soundboard'
export const COOLDOWN_MS = 3000

export const isSoundboard = (pub: Pick<TrackPublication, 'trackName'>): boolean => pub.trackName === SOUNDBOARD_TRACK

/** The participant's real microphone, never the soundboard track. */
export function micPublication(p: Participant): TrackPublication | undefined {
  for (const pub of p.audioTrackPublications.values()) {
    if (pub.source === Track.Source.Microphone && !isSoundboard(pub)) return pub
  }
  return undefined
}

/** Whether the participant has a sound going out right now. */
export function playingSound(p: Participant): boolean {
  for (const pub of p.audioTrackPublications.values()) if (isSoundboard(pub) && !pub.isMuted) return true
  return false
}

type SinkContext = AudioContext & { setSinkId?(id: string): Promise<void> }

/** Decodes a sound file once it's fetched (any of mp3/ogg/wav, as Chromium reads them). */
export async function decodeSound(url: string): Promise<AudioBuffer> {
  const data = await (await fetch(url)).arrayBuffer()
  const ctx = new OfflineAudioContext(1, 1, 48000)
  return ctx.decodeAudioData(data)
}

/**
 * Plays `buffer` into the room as the soundboard track, and here for whoever plays it at
 * `localVolume` (0..1). Stops at `maxMs` (the length the server measured) even if the file is
 * longer. Resolves once it's out; `onEnd` runs once when it stops, for any reason.
 */
export async function publishSound(
  local: LocalParticipant,
  buffer: AudioBuffer,
  { volume, localVolume, maxMs, onEnd }: { volume: number; localVolume: number; maxMs: number; onEnd(): void }
): Promise<() => void> {
  const ctx: SinkContext = new AudioContext({ sampleRate: 48000 })
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const gain = ctx.createGain()
  gain.gain.value = volume
  const out = ctx.createMediaStreamDestination()
  source.connect(gain).connect(out)
  if (localVolume > 0) {
    const monitor = ctx.createGain()
    monitor.gain.value = localVolume
    gain.connect(monitor).connect(ctx.destination)
    const output = loadMediaPrefs().audioOutput
    if (output) await ctx.setSinkId?.(output).catch(() => {})
  }
  const [track] = out.stream.getAudioTracks()

  let ended = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = (): void => {
    if (ended) return
    ended = true
    clearTimeout(timer)
    try {
      source.stop()
    } catch {
      // never started
    }
    void local.unpublishTrack(track).catch(() => {})
    track.stop()
    void ctx.close().catch(() => {})
    onEnd()
  }

  try {
    await local.publishTrack(track, {
      name: SOUNDBOARD_TRACK,
      source: Track.Source.Microphone,
      audioPreset: AudioPresets.music,
      // Silence-skipping and redundancy are for voice; a short clip plays as is.
      dtx: false,
      red: false
    })
  } catch (err) {
    stop()
    throw err
  }
  if (ended) return stop
  source.onended = stop
  source.start()
  timer = setTimeout(stop, Math.min(buffer.duration * 1000, maxMs) + 150)
  return stop
}

const LEVEL_EVERY_MS = 100
// Root mean square of the mic signal above which someone counts as speaking (about -36 dBFS),
// and how long they stay "speaking" after it drops, so words don't flicker the ring.
const SPEAKING_RMS = 0.016
const SPEAKING_HOLD_MS = 400

/**
 * Who is speaking by their mic alone, for the people with a sound playing (identity -> mic
 * track). Polls a small analyser per person only while they're watched.
 */
export class MicLevels {
  private ctx: AudioContext | null = null
  private watched = new Map<string, { track: MediaStreamTrack; analyser: AnalyserNode; source: MediaStreamAudioSourceNode; lastLoud: number }>()
  private timer: ReturnType<typeof setInterval> | null = null
  private speaking = new Set<string>()

  constructor(private readonly onChange: (speaking: Set<string>) => void) {}

  /** Watches exactly these people (identity -> their mic track, or null when it's muted/missing). */
  sync(wanted: Map<string, MediaStreamTrack | null>): void {
    for (const [id, entry] of this.watched) {
      if (wanted.get(id) !== entry.track) this.drop(id)
    }
    for (const [id, track] of wanted) {
      if (!track || this.watched.has(id)) continue
      this.ctx ??= new AudioContext()
      const source = this.ctx.createMediaStreamSource(new MediaStream([track]))
      const analyser = this.ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      this.watched.set(id, { track, analyser, source, lastLoud: 0 })
    }
    const changed = [...this.speaking].filter((id) => !this.watched.has(id))
    changed.forEach((id) => this.speaking.delete(id))
    if (changed.length) this.onChange(new Set(this.speaking))
    if (this.watched.size && !this.timer) this.timer = setInterval(() => this.poll(), LEVEL_EVERY_MS)
    if (!this.watched.size) this.stop()
  }

  stop(): void {
    for (const id of [...this.watched.keys()]) this.drop(id)
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    void this.ctx?.close().catch(() => {})
    this.ctx = null
    if (this.speaking.size) {
      this.speaking.clear()
      this.onChange(new Set())
    }
  }

  private drop(id: string): void {
    this.watched.get(id)?.source.disconnect()
    this.watched.delete(id)
  }

  private poll(): void {
    const now = performance.now()
    const samples = new Float32Array(512)
    let changed = false
    for (const [id, entry] of this.watched) {
      entry.analyser.getFloatTimeDomainData(samples)
      if (rms(samples) >= SPEAKING_RMS) entry.lastLoud = now
      const speaking = now - entry.lastLoud < SPEAKING_HOLD_MS
      if (speaking !== this.speaking.has(id)) {
        changed = true
        if (speaking) this.speaking.add(id)
        else this.speaking.delete(id)
      }
    }
    if (changed) this.onChange(new Set(this.speaking))
  }
}

export function rms(samples: Float32Array): number {
  let sum = 0
  for (const s of samples) sum += s * s
  return Math.sqrt(sum / samples.length)
}

/** Who shows as speaking: LiveKit's speakers, except that for anyone with a sound playing only
 * their mic counts (`byMic`, from MicLevels). */
export function speakingNow(activeSpeakers: string[], withSound: Set<string>, byMic: Set<string>): string[] {
  const out = activeSpeakers.filter((id) => !withSound.has(id))
  for (const id of byMic) if (withSound.has(id) && !out.includes(id)) out.push(id)
  return out
}

/** The room's participants, local first. */
export const participantsOf = (r: Room): Participant[] => [r.localParticipant, ...r.remoteParticipants.values()]
