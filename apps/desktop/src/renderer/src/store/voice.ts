import {
  AudioPresets,
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type AudioCaptureOptions,
  type LocalAudioTrack,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication
} from 'livekit-client'
import { create } from 'zustand'

import { api, ApiError, type Sound } from '../lib/api'
import { gateOf, inputGainOf, loadMediaPrefs, saveMediaPrefs, type MediaPrefs } from '../lib/mediaPrefs'
import {
  cameraPreset,
  FREE_TIER,
  screenFps,
  screenPreset,
  screenSize,
  screenSmallLayer,
  type MediaTier,
  type ScreenMode
} from '../lib/mediaTier'
import { useAppearance } from './appearance'
import { deviceLabel, useDevices, watchDevices, type Devices } from './devices'
import { MIC_PROCESSOR, MicProcessor, PROCESSING_RATE } from '../lib/micProcessor'
import { sendRealtime } from '../lib/realtime'
import {
  COOLDOWN_MS,
  decodeSound,
  isSoundboard,
  micPublication,
  MicLevels,
  participantsOf,
  playingSound,
  publishSound,
  speakingNow
} from '../lib/soundboard'
import { playSound } from '../lib/sounds'
import { soundUrl } from './soundboard'
import { startThumbnails } from '../lib/thumbnail'

type Phase = 'idle' | 'connecting' | 'connected' | 'reconnecting'

export interface ScreenShareOptions {
  sourceId: string
  /** Include system audio (Windows loopback, without this app's own audio). */
  audio: boolean
  /** 'motion' favors frame rate (games, video); 'detail' favors sharpness (text, code). */
  hint: ScreenMode
}

/** What the room's permissions let us publish (read from the LiveKit token). */
export interface Publishable {
  mic: boolean
  camera: boolean
  screen: boolean
}

const ANYTHING: Publishable = { mic: true, camera: true, screen: true }

let micProcessorSync: Promise<void> = Promise.resolve()
/** The mic capture last described in the logs (so a mute/unmute doesn't log it again). */
let loggedMic = ''

/**
 * How the mic is opened. The browser's own noise suppression stays off: RNNoise does that job
 * (see lib/micProcessor.ts), and both stacked made voices sound muffled. 48 kHz is asked for so
 * most devices need no resampling. No channel count is forced: asking for mono makes the browser
 * sum the channels, and the processor picks one instead.
 */
export function micCapture(prefs = loadMediaPrefs()): AudioCaptureOptions {
  return {
    deviceId: prefs.audioInput || undefined,
    noiseSuppression: false,
    echoCancellation: prefs.echoCancellation,
    autoGainControl: prefs.autoGainControl,
    sampleRate: { ideal: PROCESSING_RATE }
  }
}

// Push-to-talk: in that mode the mic only opens while the key is held (read by the main process,
// see lib/pushToTalk.ts). The release waits a moment so the end of a word isn't cut off.
const PTT_RELEASE_MS = 200
let pttHeld = false
let pttRelease: ReturnType<typeof setTimeout> | null = null

/** "Pressionar para falar" with a key picked; without a key the mic works as usual. */
function pushToTalkOn(): boolean {
  const prefs = loadMediaPrefs()
  return prefs.inputMode === 'ptt' && !!prefs.pttKey
}

/** Puts the mic processor (one channel, 48 kHz, RNNoise when on) on the mic track, matching the
 * setting. Calls are queued so a quick toggle can't set up two processors at once. */
function syncMicProcessor(r: Room): Promise<void> {
  micProcessorSync = micProcessorSync.then(async () => {
    const track = micPublication(r.localParticipant)?.audioTrack as LocalAudioTrack | undefined
    if (!track) return
    void logMic(track)
    const prefs = loadMediaPrefs()
    const current = track.getProcessor()
    if (current?.name === MIC_PROCESSOR && (current as MicProcessor).denoise === prefs.noiseSuppression) {
      ;(current as MicProcessor).setGate(gateOf(prefs))
      ;(current as MicProcessor).setGain(inputGainOf(prefs))
      return
    }
    try {
      await track.setProcessor(new MicProcessor(prefs.noiseSuppression, gateOf(prefs), inputGainOf(prefs)))
    } catch (err) {
      // The mic still works without it, as the device sends it.
      console.warn('Mic processor unavailable', err)
    }
  })
  return micProcessorSync
}

/** Describes the mic capture in the app's logs (attached to "Reportar problema") whenever it
 * changes: device name and what the device actually delivers (getSettings of the source track,
 * before the processor). */
async function logMic(track: LocalAudioTrack): Promise<void> {
  const { deviceId, sampleRate, channelCount, echoCancellation, autoGainControl, noiseSuppression } =
    track.getSourceTrackSettings()
  const device = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).find(
    (d) => d.kind === 'audioinput' && d.deviceId === deviceId
  )
  const line =
    `[mic] "${device?.label ?? 'desconhecido'}" sampleRate=${sampleRate} channelCount=${channelCount} ` +
    `echoCancellation=${echoCancellation} autoGainControl=${autoGainControl} noiseSuppression=${noiseSuppression} ` +
    `rnnoise=${loadMediaPrefs().noiseSuppression}`
  if (line === loggedMic) return
  loggedMic = line
  console.info(line)
}

/** The token's canPublishSources; without it (DM calls) anything goes. */
function publishableIn(token: string): Publishable {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const { video } = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')))
    if (video?.canPublish === false) return { mic: false, camera: false, screen: false }
    const sources: string[] | undefined = video?.canPublishSources
    if (!sources) return ANYTHING
    return { mic: sources.includes('microphone'), camera: sources.includes('camera'), screen: sources.includes('screen_share') }
  } catch {
    return ANYTHING
  }
}

export type DeviceKind = 'audioinput' | 'audiooutput' | 'videoinput'

const DEVICE_PREF: Record<DeviceKind, 'audioInput' | 'audioOutput' | 'videoInput'> = {
  audioinput: 'audioInput',
  audiooutput: 'audioOutput',
  videoinput: 'videoInput'
}

const DEVICE_KINDS = Object.keys(DEVICE_PREF) as DeviceKind[]
const DEVICE_NAME: Record<DeviceKind, string> = { audioinput: 'Microfone', audiooutput: 'Saída de áudio', videoinput: 'Câmera' }

function savePref(patch: Partial<MediaPrefs>): void {
  saveMediaPrefs({ ...loadMediaPrefs(), ...patch })
}

/**
 * Moves the call to a device ('' = the system default). The mic is restarted with the whole
 * capture (one channel picked, 48 kHz, the browser's own noise suppression off), never just a
 * device id: LiveKit restarts a mic that went away with only `deviceId: 'default'`, which would
 * turn the browser's processing back on under RNNoise.
 */
async function moveToDevice(r: Room, kind: DeviceKind, deviceId: string): Promise<void> {
  if (kind !== 'audioinput') {
    await r.switchActiveDevice(kind, deviceId || 'default')
    return
  }
  const capture = { ...micCapture({ ...loadMediaPrefs(), audioInput: deviceId }), deviceId: deviceId || 'default' }
  r.options.audioCaptureDefaults = capture
  const track = micPublication(r.localParticipant)?.audioTrack as LocalAudioTrack | undefined
  if (track) await track.restartTrack(capture)
  await syncMicProcessor(r)
}

/** The mic track lost the capture settings (LiveKit restarted it on its own). */
function micLostSettings(r: Room): boolean {
  const track = micPublication(r.localParticipant)?.audioTrack
  return !!track && track.mediaStreamTrack.readyState === 'live' && track.mediaStreamTrack.getConstraints().noiseSuppression !== false
}

// Kinds whose chosen device went away during the call: on the system default until it's back.
const onDefault = new Set<DeviceKind>()
let stopDeviceWatch: () => void = () => {}

interface VoiceStore {
  phase: Phase
  serverId: string | null
  channelId: string | null
  error: string | null
  muted: boolean
  deafened: boolean
  camera: boolean
  screen: boolean
  /** What we may publish in the current room; the media server enforces it too. */
  allowed: Publishable
  /** Identities (user ids) currently speaking. */
  speaking: string[]
  /** Bumped on any participant/track change so views re-read the room. */
  version: number
  /** Volume (0..1) chosen for each participant's screen-share audio; kept while tiles move around. */
  screenVolume: Record<string, number>
  /** Muted / deafened by a moderator in the current server room. */
  serverMuted: boolean
  serverDeafened: boolean
  /** Quality limits for what we publish, from the last voice token (the user's plan). */
  media: MediaTier
  /** The push-to-talk key is held (only in that input mode). */
  pttHeld: boolean
  /** A short note about the call's devices ("Headset desconectado…"), shown as a toast. */
  notice: { text: string; id: number } | null
  /** Whose screen shares we receive. Nobody's until "Assistir": the call only subscribes to
   * microphones and cameras on its own (bandwidth, and nobody gets a stream they didn't ask for). */
  watching: string[]
  /** The latest small preview of each screen share in the room (blurred on the "Assistir" card). */
  screenPreviews: Record<string, string>
  /** Who is watching our screen share ("N assistindo"), as their apps tell us. */
  watchers: string[]
  /** Painel de sons: the sound we're playing (id) and until when (ms epoch) we can't play the
   * next one (its length, 3 s at least). */
  boardSound: string | null
  boardUntil: number

  /** Joins a server voice room, or a private call (serverId null, channelId = the conversation). */
  join(serverId: string | null, channelId: string): Promise<void>
  /** Leaves the room; `quiet` skips the leave sound (switching rooms, or a sound of its own follows). */
  leave(quiet?: boolean): Promise<void>
  toggleMute(): Promise<void>
  toggleDeafen(): void
  toggleCamera(): Promise<void>
  startScreenShare(options: ScreenShareOptions): Promise<void>
  stopScreenShare(): Promise<void>
  setScreenVolume(identity: string, volume: number): void
  /** "Assistir": receives this person's screen share (video and its audio). */
  watchScreen(identity: string): void
  /** "Parar de assistir": stops receiving it. */
  stopWatching(identity: string): void
  /** A moderator changed our server mute / deafen (from our own voice state). */
  setModeration(muted: boolean, deafened: boolean): void
  applyDevicePrefs(): Promise<void>
  /** Picks a device in the call, without leaving it, and keeps it as the preference ('' = the
   * system default). */
  switchDevice(kind: DeviceKind, deviceId: string): Promise<void>
  /** The mic or output volume (0-200 %), live and saved. */
  setVolume(which: 'inputVolume' | 'outputVolume', percent: number): void
  /** The push-to-talk key went down or up (from the main process). */
  setPushToTalk(held: boolean): void
  /** The input mode or the push-to-talk key changed in Settings. */
  applyInputMode(): Promise<void>
  /** Applies noise suppression and sensitivity changes to the mic in the call, without
   * reopening the device (echo cancellation and auto gain need applyDevicePrefs). */
  applyMicProcessing(): Promise<void>
  /** Plays one of the server's sounds in the room (see lib/soundboard.ts). */
  playBoardSound(sound: Sound): Promise<void>
  stopBoardSound(): void
  /** Re-sends our voice state (after the WebSocket reconnects). */
  announce(): void
  clearError(): void
}

// The LiveKit room lives outside the store: it's a mutable object, not state.
let room: Room | null = null
// Tracks of our own screen share (video + optional system audio).
let shareTracks: MediaStreamTrack[] = []
// Stops the overview thumbnails of our screen share.
let stopThumbnails: () => void = () => {}
// Remote audio tracks get attached to elements we own, but play through the room's Web Audio
// graph (webAudioMix): a gain per track, which allows the 0-200% volumes. See applyVolumes.
const audioSink = document.createElement('div')
audioSink.hidden = true
document.body.appendChild(audioSink)

export function getRoom(): Room | null {
  return room
}

// What the room's token lets us publish; `allowed` also takes a server mute into account.
let tokenAllowed: Publishable = ANYTHING

const SCREEN_SOURCES: Track.Source[] = [Track.Source.ScreenShare, Track.Source.ScreenShareAudio]

/** The call connects with autoSubscribe off: mic and camera are received right away, a screen
 * share (and its audio) only while watching it. */
export function wantsTrack(pub: Pick<RemoteTrackPublication, 'source'> & Partial<Pick<RemoteTrackPublication, 'trackName'>>, identity: string): boolean {
  // Others' sounds, unless "Silenciar sons dos outros".
  if (pub.trackName && isSoundboard({ trackName: pub.trackName })) return !useAppearance.getState().settings.soundboard_muted
  if (pub.source === Track.Source.Microphone || pub.source === Track.Source.Camera) return true
  return SCREEN_SOURCES.includes(pub.source) && useVoice.getState().watching.includes(identity)
}

// Room data messages between apps (LiveKit data channel; the sender's identity is set by the
// media server, so it can't be faked). Screen previews go to everyone, "watching" only to the sharer.
const PREVIEW_TOPIC = 'aureum.screen-preview'
const WATCH_TOPIC = 'aureum.screen-watch'
const MAX_PREVIEW_CHARS = 64 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function sendData(r: Room, topic: string, data: unknown, to?: string[]): void {
  void r.localParticipant
    .publishData(encoder.encode(JSON.stringify(data)), { reliable: true, topic, destinationIdentities: to })
    .catch(() => {})
}

/** Asks the media server for what we want of this person (a no-op for what we already get). */
function syncSubscriptions(p: RemoteParticipant): void {
  for (const pub of p.trackPublications.values()) pub.setSubscribed(wantsTrack(pub, p.identity))
}

/** How loud a remote audio track plays: 0 while deafened (by us or the server), else the
 * screen-share volume for stream audio, our soundboard volume for their sounds (silent when we
 * muted the person), or the person's volume (0-2) unless muted locally; times the output volume
 * (0-2). */
function volumeFor(identity: string, pub: Pick<RemoteTrackPublication, 'source' | 'trackName'>): number {
  const { deafened, serverDeafened, screenVolume } = useVoice.getState()
  if (deafened || serverDeafened) return 0
  const output = loadMediaPrefs().outputVolume / 100
  if (pub.source === Track.Source.ScreenShareAudio) return (screenVolume[identity] ?? 1) * output
  const { user_audio, soundboard_volume } = useAppearance.getState().settings
  const audio = user_audio[identity]
  if (isSoundboard(pub)) return audio?.muted ? 0 : (soundboard_volume / 100) * output
  return audio?.muted ? 0 : ((audio?.volume ?? 100) / 100) * output
}

function applyVolumes(): void {
  for (const p of room?.remoteParticipants.values() ?? []) {
    for (const pub of p.audioTrackPublications.values()) {
      ;(pub.track as RemoteAudioTrack | undefined)?.setVolume(volumeFor(p.identity, pub))
    }
  }
}

// Volumes set on another PC (or in a menu) apply right away; so does "Silenciar sons dos outros".
useAppearance.subscribe((s, prev) => {
  const now = s.settings
  const before = prev.settings
  if (now.user_audio !== before.user_audio || now.soundboard_volume !== before.soundboard_volume) applyVolumes()
  if (now.soundboard_muted !== before.soundboard_muted) for (const p of room?.remoteParticipants.values() ?? []) syncSubscriptions(p)
})

/** Sets how loud someone sounds to us (0-200%) and/or mutes them just for us. Saved per user. */
export function setUserAudio(userId: string, change: { volume?: number; muted?: boolean }): void {
  const cur = useAppearance.getState().settings.user_audio[userId] ?? { volume: 100, muted: false }
  const next = { ...cur, ...change }
  useAppearance.getState().updateEntry('user_audio', userId, next.volume === 100 && !next.muted ? null : next)
}

// Test builds (electron-vite build --mode test) expose internals to end-to-end scripts.
if (import.meta.env.MODE === 'test') {
  Object.assign(window, { __aureumTest: { room: () => room, shareTracks: () => shareTracks } })
}

export const useVoice = create<VoiceStore>()((set, get) => {
  const bump = (): void => set((s) => ({ version: s.version + 1 }))

  // Who's speaking (see lib/soundboard.ts): LiveKit's active speakers, but for anyone with a
  // sound playing only their mic counts, measured here.
  let activeSpeakers: string[] = []
  let byMic = new Set<string>()
  let stopBoard: (() => void) | null = null
  const micLevels = new MicLevels((speaking) => {
    byMic = speaking
    refreshSpeaking()
  })
  function refreshSpeaking(): void {
    const r = room
    const withSound = new Set<string>()
    const mics = new Map<string, MediaStreamTrack | null>()
    for (const p of r ? participantsOf(r) : []) {
      if (!playingSound(p)) continue
      withSound.add(p.identity)
      const mic = micPublication(p)
      mics.set(p.identity, mic && !mic.isMuted ? (mic.track?.mediaStreamTrack ?? null) : null)
    }
    micLevels.sync(mics)
    const speaking = speakingNow(activeSpeakers, withSound, byMic)
    const prev = get().speaking
    if (speaking.length !== prev.length || speaking.some((id, i) => id !== prev[i])) set({ speaking })
  }

  const announce = (): void => {
    const { phase, channelId, muted, deafened, camera, screen, allowed } = get()
    const inCall = phase !== 'idle' && channelId
    sendRealtime(
      'voice.update',
      inCall ? { channel_id: channelId, muted: muted || !allowed.mic, deafened, camera, screen } : { channel_id: null }
    )
  }

  /** Starts reading the push-to-talk key while in a call in that mode; stops it otherwise. */
  const syncPushToTalk = (): void => {
    const inCall = !!room && get().phase !== 'idle'
    void window.aureum.ptt.watch(inCall && pushToTalkOn() ? loadMediaPrefs().pttKey : null)
    if (!inCall || !pushToTalkOn()) {
      if (pttRelease) clearTimeout(pttRelease)
      pttHeld = false
      if (get().pttHeld) set({ pttHeld: false })
    }
  }

  /** Whether our mic should be sending right now. */
  const micOpen = (): boolean => {
    const { muted, deafened, allowed } = get()
    return !muted && !deafened && allowed.mic && (!pushToTalkOn() || pttHeld)
  }

  const notify = (text: string): void => set((s) => ({ notice: { text, id: (s.notice?.id ?? 0) + 1 } }))

  /**
   * A device came or went during the call. If the chosen one went away, the call moves to the
   * system default and says so; when it comes back, the call moves back to it.
   */
  async function onDevicesChanged(devices: Devices, before: Devices | null): Promise<void> {
    const r = room
    if (!r || get().phase === 'idle') return
    const prefs = loadMediaPrefs()
    for (const kind of DEVICE_KINDS) {
      const chosen = prefs[DEVICE_PREF[kind]]
      if (!chosen) continue
      // A camera that's off has nothing to move: turning it on reads the preference.
      const live = kind !== 'videoinput' || get().camera
      const present = devices[kind].some((d) => d.deviceId === chosen)
      try {
        if (!present && !onDefault.has(kind)) {
          onDefault.add(kind)
          notify(`${deviceLabel(before?.[kind], chosen) ?? DEVICE_NAME[kind]} desconectado. Usando o padrão do Windows.`)
          if (live) await moveToDevice(r, kind, '')
        } else if (present && onDefault.has(kind)) {
          onDefault.delete(kind)
          notify(`Usando ${deviceLabel(devices[kind], chosen)} de novo.`)
          if (live) await moveToDevice(r, kind, chosen)
        }
      } catch {
        // The next device change tries again.
      }
    }
    // The system default mic went away and LiveKit restarted it bare: put the capture back.
    if (room === r && micLostSettings(r)) {
      await moveToDevice(r, 'audioinput', onDefault.has('audioinput') ? '' : prefs.audioInput).catch(() => {})
    }
  }

  useDevices.subscribe((s, prev) => {
    if (s.devices && s.devices !== prev.devices) void onDevicesChanged(s.devices, prev.devices)
  })

  const reset = (error: string | null = null): void => {
    room = null
    stopBoard?.()
    activeSpeakers = []
    micLevels.stop()
    stopDeviceWatch()
    onDefault.clear()
    audioSink.replaceChildren()
    stopThumbnails()
    shareTracks.forEach((t) => t.stop())
    shareTracks = []
    tokenAllowed = ANYTHING
    set({
      phase: 'idle',
      serverId: null,
      channelId: null,
      camera: false,
      screen: false,
      allowed: ANYTHING,
      serverMuted: false,
      serverDeafened: false,
      speaking: [],
      screenVolume: {},
      watching: [],
      screenPreviews: {},
      watchers: [],
      boardSound: null,
      error
    })
    syncPushToTalk()
    bump()
  }

  function wire(r: Room): void {
    const isCurrent = (): boolean => room === r
    r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub, participant) => {
      if (track.kind === Track.Kind.Audio) {
        audioSink.appendChild(track.attach())
        ;(track as RemoteAudioTrack).setVolume(volumeFor(participant.identity, pub))
      }
      bump()
    })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove())
        bump()
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        activeSpeakers = speakers.map((p) => p.identity)
        refreshSpeaking()
      })
      .on(RoomEvent.Reconnecting, () => isCurrent() && set({ phase: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => isCurrent() && set({ phase: 'connected' }))
      .on(RoomEvent.ParticipantConnected, () => isCurrent() && playSound('user-join', { fromOthers: true }))
      .on(RoomEvent.ParticipantDisconnected, () => isCurrent() && playSound('user-leave', { fromOthers: true }))
      .on(RoomEvent.TrackPublished, (pub, participant) => {
        if (!isCurrent()) return
        if (wantsTrack(pub, participant.identity)) pub.setSubscribed(true)
        if (pub.source === Track.Source.ScreenShare) playSound('screen-share', { fromOthers: true })
      })
      // The share ended: watching it again takes a new "Assistir".
      .on(RoomEvent.TrackUnpublished, (pub, participant) => {
        if (!isCurrent() || pub.source !== Track.Source.ScreenShare) return
        get().stopWatching(participant.identity)
        dropPreview(participant.identity)
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        if (!isCurrent()) return
        get().stopWatching(participant.identity)
        dropPreview(participant.identity)
        set((s) => ({ watchers: s.watchers.filter((id) => id !== participant.identity) }))
      })
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (isCurrent()) onData(participant?.identity, topic, payload)
      })
      // A server deafen lifted: ask again for what we want to receive.
      .on(RoomEvent.ParticipantPermissionsChanged, () => {
        if (isCurrent()) for (const p of r.remoteParticipants.values()) syncSubscriptions(p)
      })
      .on(RoomEvent.Disconnected, () => {
        if (!isCurrent()) return // we left on purpose
        playSound('call-leave')
        reset('Você foi desconectado da voz.')
        announce()
      })
    for (const event of [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished
    ]) {
      r.on(event, bump)
    }
    // A sound started or ended somewhere, or a mic was muted: who counts as speaking changes.
    for (const event of [
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantDisconnected
    ]) {
      r.on(event, () => isCurrent() && refreshSpeaking())
    }
  }

  function dropPreview(identity: string): void {
    if (!(identity in get().screenPreviews)) return
    set((s) => {
      const screenPreviews = { ...s.screenPreviews }
      delete screenPreviews[identity]
      return { screenPreviews }
    })
  }

  /** A data message from another app in the room; anything unexpected is ignored. */
  function onData(identity: string | undefined, topic: string | undefined, payload: Uint8Array): void {
    if (!identity || !room) return
    let data: unknown
    try {
      data = JSON.parse(decoder.decode(payload))
    } catch {
      return
    }
    if (!data || typeof data !== 'object') return
    if (topic === PREVIEW_TOPIC) {
      const { image } = data as { image?: unknown }
      const ok = typeof image === 'string' && image.length <= MAX_PREVIEW_CHARS && image.startsWith('data:image/jpeg;base64,')
      if (ok && isSharing(identity)) set((s) => ({ screenPreviews: { ...s.screenPreviews, [identity]: image } }))
    } else if (topic === WATCH_TOPIC && get().screen) {
      const { watching } = data as { watching?: unknown }
      if (typeof watching !== 'boolean') return
      set((s) => {
        const others = s.watchers.filter((id) => id !== identity)
        return { watchers: watching ? [...others, identity] : others }
      })
    }
  }

  /** Publishes or mutes the mic to match the muted/deafened flags (and the push-to-talk key).
   * Push-to-talk presses skip the announce: others see our mute state, not every press. */
  async function applyMic(announceIt = true): Promise<void> {
    const r = room
    if (r && r.state === ConnectionState.Connected) {
      await r.localParticipant.setMicrophoneEnabled(micOpen()).catch(() => {
        set({ muted: true, error: 'Não foi possível acessar o microfone.' })
      })
      await syncMicProcessor(r)
    }
    if (announceIt) announce()
    bump()
  }

  return {
    phase: 'idle',
    serverId: null,
    channelId: null,
    error: null,
    muted: false,
    deafened: false,
    camera: false,
    screen: false,
    allowed: ANYTHING,
    speaking: [],
    version: 0,
    screenVolume: {},
    serverMuted: false,
    serverDeafened: false,
    media: FREE_TIER,
    pttHeld: false,
    notice: null,
    watching: [],
    screenPreviews: {},
    watchers: [],
    boardSound: null,
    boardUntil: 0,

    join: async (serverId, channelId) => {
      if (get().channelId === channelId && get().phase !== 'idle') return
      if (room) await get().leave(true)

      set({ phase: 'connecting', serverId, channelId, error: null, camera: false })
      const prefs = loadMediaPrefs()
      const r = new Room({
        // Bandwidth (the LiveKit Cloud quota): adaptiveStream sizes each subscription to the
        // <video> showing it (small tile -> low layer, off-screen or hidden -> paused), and
        // dynacast stops encoding layers nobody is receiving.
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          simulcast: true,
          videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360]
        },
        audioCaptureDefaults: micCapture(prefs),
        videoCaptureDefaults: {
          deviceId: prefs.videoInput || undefined,
          resolution: VideoPresets.h720.resolution
        },
        audioOutput: prefs.audioOutput ? { deviceId: prefs.audioOutput } : undefined,
        // Remote audio through Web Audio gains: per-person volume can go above 100%.
        webAudioMix: true
      })
      room = r
      wire(r)

      try {
        const { token, url, media } = await api<{ token: string; url: string; media?: MediaTier }>(
          `/channels/${channelId}/voice/token`,
          { method: 'POST' }
        )
        tokenAllowed = publishableIn(token)
        set({ allowed: tokenAllowed, media: media ?? FREE_TIER })
        await r.connect(url, token, { autoSubscribe: false })
      } catch {
        if (room === r) {
          await r.disconnect()
          reset('Não foi possível entrar no canal de voz.')
        }
        return
      }
      if (room !== r) return // left while connecting
      // Whoever was already in the room: their mics and cameras.
      for (const p of r.remoteParticipants.values()) syncSubscriptions(p)

      set({ phase: 'connected' })
      // Devices plugged in or out during the call (see onDevicesChanged).
      stopDeviceWatch = watchDevices()
      playSound('call-join')
      announce()
      // With webAudioMix the output device is set on the room's AudioContext.
      if (prefs.audioOutput) await r.switchActiveDevice('audiooutput', prefs.audioOutput).catch(() => {})
      syncPushToTalk()
      try {
        const { muted, deafened, allowed } = get()
        // In push-to-talk the mic is published muted, so the first press opens it right away.
        await r.localParticipant.setMicrophoneEnabled(!muted && !deafened && allowed.mic)
        if (!micOpen()) await r.localParticipant.setMicrophoneEnabled(false)
        await syncMicProcessor(r)
      } catch {
        set({ muted: true, error: 'Não foi possível acessar o microfone. Confira as Configurações.' })
        announce()
      }
    },

    leave: async (quiet = false) => {
      const r = room
      if (!r) return
      if (!quiet && get().phase !== 'connecting') playSound('call-leave')
      reset()
      announce()
      await r.disconnect()
    },

    toggleMute: async () => {
      const { muted, deafened, allowed } = get()
      if (!allowed.mic) return
      // Unmuting while deafened also undeafens, like Discord.
      const nextMuted = deafened ? false : !muted
      set({ muted: nextMuted, deafened: false })
      playSound(deafened ? 'undeafen' : nextMuted ? 'mute' : 'unmute')
      applyVolumes()
      await applyMic()
    },

    toggleDeafen: () => {
      const deafened = !get().deafened
      if (deafened) get().stopBoardSound()
      set({ deafened })
      playSound(deafened ? 'deafen' : 'undeafen')
      applyVolumes()
      void applyMic()
    },

    toggleCamera: async () => {
      const r = room
      if (!r || get().phase === 'connecting') return
      const next = !get().camera
      if (next && !get().allowed.camera) return
      try {
        // Within the plan's limits: its resolution and frame rate, with smaller simulcast layers
        // for whoever watches in a small tile.
        const preset = cameraPreset(get().media)
        await r.localParticipant.setCameraEnabled(
          next,
          next ? { deviceId: loadMediaPrefs().videoInput || undefined, resolution: preset.resolution } : undefined,
          next ? { videoEncoding: preset.encoding, simulcast: true, videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360] } : undefined
        )
        set({ camera: next })
      } catch {
        set({ camera: false, error: 'Não foi possível ligar a câmera. Confira as Configurações.' })
      }
      announce()
      bump()
    },

    startScreenShare: async ({ sourceId, audio, hint }) => {
      const r = room
      if (!r || get().phase !== 'connected' || !get().allowed.screen) return
      if (get().screen) await get().stopScreenShare()

      // The main process hands this source to getDisplayMedia (see setDisplayMediaRequestHandler).
      await window.aureum.screen.select(sourceId, audio)
      // Captured at most at the plan's resolution and the mode's frame rate.
      const tier = get().media
      const size = screenSize(tier)
      const fps = screenFps(tier, hint)
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: fps, max: fps }, width: { max: size.width }, height: { max: size.height } },
          audio: audio
            ? ({
                // Drops audio played by this app (the call itself), so nobody hears an echo
                // of their own voice; game and other app audio still goes through.
                restrictOwnAudio: true,
                // Game/music audio must not be "cleaned up" like a microphone.
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 2
              } as MediaTrackConstraints)
            : false
        })
      } catch {
        set({ error: 'Não foi possível compartilhar a tela.' })
        return
      }
      if (room !== r) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      const [video] = stream.getVideoTracks()
      const [systemAudio] = stream.getAudioTracks()
      video.contentHint = hint
      // Fires when the shared window closes or capture stops outside the app.
      video.addEventListener('ended', () => void get().stopScreenShare())
      shareTracks = stream.getTracks()

      try {
        await r.localParticipant.publishTrack(video, {
          source: Track.Source.ScreenShare,
          videoEncoding: screenPreset(tier, hint).encoding,
          // A lower layer for viewers watching in a side tile instead of in focus.
          simulcast: true,
          screenShareSimulcastLayers: [screenSmallLayer(hint)],
          // Under pressure, "Texto nítido" keeps its resolution and "Movimento" its frame rate.
          degradationPreference: hint === 'motion' ? 'maintain-framerate' : 'maintain-resolution'
        })
        if (systemAudio) {
          await r.localParticipant.publishTrack(systemAudio, {
            source: Track.Source.ScreenShareAudio,
            audioPreset: AudioPresets.musicHighQualityStereo,
            dtx: false,
            red: false,
            forceStereo: true
          })
        }
      } catch {
        await get().stopScreenShare()
        set({ error: 'Não foi possível transmitir a tela.' })
        return
      }
      set({ screen: true })
      playSound('screen-share')
      announce()
      // After announce(): the server only takes thumbnails from someone marked as sharing.
      stopThumbnails = startThumbnails(
        video,
        (image) => sendRealtime('screen.thumbnail', { image }),
        (image) => room === r && sendData(r, PREVIEW_TOPIC, { image })
      )
      bump()
    },

    stopScreenShare: async () => {
      stopThumbnails()
      const tracks = shareTracks
      shareTracks = []
      const r = room
      for (const track of tracks) {
        track.stop()
        if (r) await r.localParticipant.unpublishTrack(track).catch(() => {})
      }
      if (get().screen) {
        set({ screen: false, watchers: [] })
        announce()
      }
      bump()
    },

    setScreenVolume: (identity, volume) => {
      set((s) => ({ screenVolume: { ...s.screenVolume, [identity]: volume } }))
      applyVolumes()
    },

    watchScreen: (identity) => {
      if (get().watching.includes(identity)) return
      set((s) => ({ watching: [...s.watching, identity] }))
      const p = room?.remoteParticipants.get(identity)
      if (p) syncSubscriptions(p)
      if (room) sendData(room, WATCH_TOPIC, { watching: true }, [identity])
      bump()
    },

    stopWatching: (identity) => {
      if (!get().watching.includes(identity)) return
      set((s) => ({ watching: s.watching.filter((id) => id !== identity) }))
      const p = room?.remoteParticipants.get(identity)
      if (p) syncSubscriptions(p)
      if (room) sendData(room, WATCH_TOPIC, { watching: false }, [identity])
      bump()
    },

    setModeration: (serverMuted, serverDeafened) => {
      if (serverMuted === get().serverMuted && serverDeafened === get().serverDeafened) return
      if (serverMuted || serverDeafened) get().stopBoardSound()
      set({ serverMuted, serverDeafened, allowed: { ...tokenAllowed, mic: tokenAllowed.mic && !serverMuted && !serverDeafened } })
      applyVolumes()
      // Lifted: the mic comes back as the user had it (and our state is re-announced).
      void applyMic()
    },

    applyDevicePrefs: async () => {
      const r = room
      if (!r) return
      const prefs = loadMediaPrefs()
      if (prefs.audioOutput) await r.switchActiveDevice('audiooutput', prefs.audioOutput).catch(() => {})
      if (get().camera && prefs.videoInput) await r.switchActiveDevice('videoinput', prefs.videoInput).catch(() => {})
      // Restart the mic so a new device takes effect (RNNoise on/off is the processor's job).
      if (r.localParticipant.isMicrophoneEnabled) {
        await r.localParticipant.setMicrophoneEnabled(false)
        await r.localParticipant
          .setMicrophoneEnabled(true, micCapture(prefs))
          .catch(() => set({ error: 'Não foi possível usar esse microfone.' }))
      }
      await syncMicProcessor(r)
      bump()
    },

    switchDevice: async (kind, deviceId) => {
      savePref({ [DEVICE_PREF[kind]]: deviceId })
      const r = room
      if (r) {
        // The camera only when it's on: turning it on reads the preference.
        const live = kind !== 'videoinput' || get().camera
        onDefault.delete(kind)
        try {
          if (live) await moveToDevice(r, kind, deviceId)
        } catch {
          set({
            error:
              kind === 'audioinput'
                ? 'Não foi possível usar esse microfone.'
                : kind === 'videoinput'
                  ? 'Não foi possível usar essa câmera.'
                  : 'Não foi possível usar essa saída de áudio.'
          })
        }
      }
      bump()
    },

    setVolume: (which, percent) => {
      savePref({ [which]: Math.round(Math.min(200, Math.max(0, percent))) })
      if (which === 'outputVolume') applyVolumes()
      else if (room) void syncMicProcessor(room)
      bump()
    },

    setPushToTalk: (held) => {
      if (!room || !pushToTalkOn()) return
      const { muted, deafened, allowed } = get()
      const canTalk = !muted && !deafened && allowed.mic
      if (held) {
        if (pttRelease) clearTimeout(pttRelease)
        pttRelease = null
        if (pttHeld) return
        pttHeld = true
        set({ pttHeld: true })
        if (canTalk) playSound('ptt-on')
        void applyMic(false)
      } else if (pttHeld && !pttRelease) {
        pttRelease = setTimeout(() => {
          pttRelease = null
          pttHeld = false
          set({ pttHeld: false })
          if (canTalk) playSound('ptt-off')
          void applyMic(false)
        }, PTT_RELEASE_MS)
      }
    },

    applyInputMode: async () => {
      syncPushToTalk()
      await applyMic(false)
    },

    applyMicProcessing: async () => {
      if (room) await syncMicProcessor(room)
    },

    playBoardSound: async (sound) => {
      const r = room
      const { phase, serverId, deafened, serverDeafened, allowed, boardSound, boardUntil } = get()
      if (!r || phase !== 'connected' || serverId !== sound.server_id || deafened || serverDeafened || !allowed.mic) return
      if (boardSound || Date.now() < boardUntil) return
      set({ boardSound: sound.id })
      try {
        const buffer = await decodeSound(await soundUrl(sound))
        // The API holds the lock (one at a time, 3 s apart) and checks the permissions.
        await api(`/sounds/${sound.id}/play`, { method: 'POST' })
        if (room !== r || get().deafened) return set({ boardSound: null })
        const length = Math.min(buffer.duration * 1000, sound.duration_ms)
        set({ boardUntil: Date.now() + Math.max(length, COOLDOWN_MS) })
        const { soundboard_volume } = useAppearance.getState().settings
        stopBoard = await publishSound(r.localParticipant, buffer, {
          volume: sound.volume / 100,
          localVolume: (soundboard_volume / 100) * (loadMediaPrefs().outputVolume / 100),
          maxMs: sound.duration_ms,
          onEnd: () => {
            stopBoard = null
            if (get().boardSound === sound.id) set({ boardSound: null })
            // LiveKit's mic helpers take the first mic-source track: if the real mic was toggled
            // while the sound was out, put it back as it should be.
            if (room === r) void applyMic(false)
          }
        })
        // Deafened, muted by the server or left while it was going out.
        if (room !== r || get().deafened || get().serverMuted || get().serverDeafened) stopBoard?.()
      } catch (err) {
        const busy = err instanceof ApiError && err.status === 429
        set({
          boardSound: null,
          ...(busy && { boardUntil: Date.now() + COOLDOWN_MS }),
          error: busy ? null : err instanceof ApiError && err.status === 403 ? 'Você não pode tocar sons agora.' : 'Não foi possível tocar o som.'
        })
      }
    },

    stopBoardSound: () => stopBoard?.(),

    announce,
    clearError: () => set({ error: null })
  }

})

// The main process reports the push-to-talk key (only while we asked it to watch it).
window.aureum.ptt.onHeld((held) => useVoice.getState().setPushToTalk(held))

/** Remote/local camera track of a participant, if it's on. */
export function cameraTrackOf(identity: string): Track | undefined {
  const r = room
  if (!r) return undefined
  const p = identity === r.localParticipant.identity ? r.localParticipant : r.remoteParticipants.get(identity)
  const pub = p?.getTrackPublication(Track.Source.Camera) as RemoteTrackPublication | undefined
  return pub && !pub.isMuted ? pub.track : undefined
}

/** Whether a participant's real mic is on (a sound playing doesn't count). */
export function micEnabled(identity: string): boolean {
  const r = room
  const p = r && (identity === r.localParticipant.identity ? r.localParticipant : r.remoteParticipants.get(identity))
  const pub = p ? micPublication(p) : undefined
  return !!pub && !pub.isMuted
}

/** Whether a participant is sharing their screen right now, watched or not. */
export function isSharing(identity: string): boolean {
  const r = room
  if (!r) return false
  const p = identity === r.localParticipant.identity ? r.localParticipant : r.remoteParticipants.get(identity)
  const pub = p?.getTrackPublication(Track.Source.ScreenShare)
  return !!pub && !pub.isMuted
}

/** Screen-share video of a participant, if they're sharing and we're watching it (or it's ours). */
export function screenTrackOf(identity: string): Track | undefined {
  const r = room
  if (!r) return undefined
  const p = identity === r.localParticipant.identity ? r.localParticipant : r.remoteParticipants.get(identity)
  const pub = p?.getTrackPublication(Track.Source.ScreenShare)
  return pub && !pub.isMuted ? pub.track : undefined
}

/** Remote screen-share audio of a participant (for its volume slider). */
export function screenAudioOf(identity: string): RemoteAudioTrack | undefined {
  const pub = room?.remoteParticipants.get(identity)?.getTrackPublication(Track.Source.ScreenShareAudio)
  return pub?.track as RemoteAudioTrack | undefined
}

/** Participants currently in the room (local first), or [] when not in a call. */
export function roomIdentities(): string[] {
  const r = room
  if (!r) return []
  return [r.localParticipant.identity, ...r.remoteParticipants.keys()]
}
