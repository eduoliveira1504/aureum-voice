import { useAppearance } from '../store/appearance'
import { loadMediaPrefs } from './mediaPrefs'

/**
 * The app's UI sounds (synthesized by scripts/generate-sounds.mjs, see docs/sounds/LICENSES.md),
 * played through Web Audio on the chosen speakers. Each one can be switched off in Settings >
 * Sounds; its setting key is the file name with dots (call-join -> call.join).
 */

// Built into the bundle as base64: the packaged app loads from file://, where fetch() can't read files.
const FILES = import.meta.glob<string>('../assets/sounds/*.ogg', { eager: true, query: '?base64', import: 'default' })

export type SoundName =
  | 'call-join'
  | 'call-leave'
  | 'user-join'
  | 'user-leave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'message'
  | 'call-ringing'
  | 'call-outgoing'
  | 'call-ended'
  | 'screen-share'

/** The user's own actions: they confirm what was done, so Do not disturb keeps them. */
export const OWN_SOUNDS: SoundName[] = ['call-join', 'call-leave', 'call-outgoing', 'mute', 'unmute', 'deafen', 'undeafen', 'call-ended']
/** Caused by other people: silenced by Do not disturb. */
export const OTHERS_SOUNDS: SoundName[] = ['message', 'call-ringing', 'user-join', 'user-leave', 'screen-share']

export const soundKey = (name: SoundName): string => name.replace('-', '.')

export interface PlayOptions {
  /** Someone else caused it (a message, a person joining...): silent in Do not disturb. */
  fromOthers?: boolean
  /** Multiplies the user's sound volume (e.g. quieter message sounds during a call). */
  volume?: number
  /** Plays even if the event is switched off (previews in Settings). */
  force?: boolean
}

let context: AudioContext | null = null
let sinkId = ''
const buffers = new Map<SoundName, Promise<AudioBuffer>>()

function audioContext(): AudioContext {
  context ??= new AudioContext()
  const output = loadMediaPrefs().audioOutput
  if (output !== sinkId) {
    sinkId = output
    const ctx = context as AudioContext & { setSinkId?: (id: string) => Promise<void> }
    ctx.setSinkId?.(output).catch(() => {})
  }
  void context.resume()
  return context
}

function load(ctx: AudioContext, name: SoundName): Promise<AudioBuffer> {
  let buffer = buffers.get(name)
  if (!buffer) {
    const data = Uint8Array.from(atob(FILES[`../assets/sounds/${name}.ogg`]), (c) => c.charCodeAt(0))
    buffer = ctx.decodeAudioData(data.buffer)
    buffer.catch(() => buffers.delete(name)) // try again next time
    buffers.set(name, buffer)
  }
  return buffer
}

/** The volume (0..1) a sound plays at right now, or 0 if it shouldn't play. */
function volumeOf(name: SoundName, { fromOthers, volume = 1, force }: PlayOptions): number {
  const { sounds, status } = useAppearance.getState().settings
  if (!force && sounds.events[soundKey(name)] === false) return 0
  if (!force && fromOthers && status === 'dnd') return 0
  return (sounds.volume / 100) * volume
}

function start(name: SoundName, gain: number, loop: boolean): () => void {
  const ctx = audioContext()
  let source: AudioBufferSourceNode | null = null
  let stopped = false
  void load(ctx, name).then(
    (buffer) => {
      if (stopped) return
      const amp = ctx.createGain()
      amp.gain.value = gain
      amp.connect(ctx.destination)
      source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = loop
      source.connect(amp)
      source.onended = () => amp.disconnect()
      source.start()
    },
    () => {}
  )
  return () => {
    stopped = true
    source?.stop()
  }
}

/** Plays a sound once (if it's switched on). */
export function playSound(name: SoundName, options: PlayOptions = {}): void {
  const gain = volumeOf(name, options)
  if (gain > 0) start(name, gain, false)
}

/** Plays a sound on repeat (ringing) until the returned function is called. */
export function loopSound(name: SoundName, options: PlayOptions = {}): () => void {
  const gain = volumeOf(name, options)
  return gain > 0 ? start(name, gain, true) : () => {}
}
