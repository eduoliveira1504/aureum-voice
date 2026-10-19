import {
  AudioPresets,
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type LocalAudioTrack,
  type RemoteAudioTrack,
  type RemoteTrack,
  type RemoteTrackPublication
} from 'livekit-client'
import { create } from 'zustand'

import { api } from '../lib/api'
import { loadMediaPrefs } from '../lib/mediaPrefs'
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
import { NOISE_FILTER, NoiseFilter } from '../lib/noiseFilter'
import { sendRealtime } from '../lib/realtime'
import { playSound } from '../lib/sounds'
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

let noiseFilterSync: Promise<void> = Promise.resolve()

/** Puts the RNNoise filter on the mic track, or takes it off, to match the setting. Calls are
 * queued so a quick toggle can't set up two filters at once. */
function syncNoiseFilter(r: Room): Promise<void> {
  noiseFilterSync = noiseFilterSync.then(async () => {
    const track = r.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack as LocalAudioTrack | undefined
    if (!track) return
    const want = loadMediaPrefs().noiseSuppression
    const has = track.getProcessor()?.name === NOISE_FILTER
    try {
      if (want && !has) await track.setProcessor(new NoiseFilter())
      else if (!want && has) await track.stopProcessor()
    } catch (err) {
      // The mic still works without it (with the browser's own, weaker suppression).
      console.warn('Noise filter unavailable', err)
    }
  })
  return noiseFilterSync
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
  /** A moderator changed our server mute / deafen (from our own voice state). */
  setModeration(muted: boolean, deafened: boolean): void
  applyDevicePrefs(): Promise<void>
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

/** How loud a remote audio track plays: 0 while deafened (by us or the server), else the
 * screen-share volume for stream audio, or the person's volume (0-2) unless muted locally. */
function volumeFor(identity: string, source: Track.Source): number {
  const { deafened, serverDeafened, screenVolume } = useVoice.getState()
  if (deafened || serverDeafened) return 0
  if (source === Track.Source.ScreenShareAudio) return screenVolume[identity] ?? 1
  const audio = useAppearance.getState().settings.user_audio[identity]
  return audio?.muted ? 0 : (audio?.volume ?? 100) / 100
}

function applyVolumes(): void {
  for (const p of room?.remoteParticipants.values() ?? []) {
    for (const pub of p.audioTrackPublications.values()) {
      ;(pub.track as RemoteAudioTrack | undefined)?.setVolume(volumeFor(p.identity, pub.source))
    }
  }
}

// Volumes set on another PC (or in a menu) apply right away.
useAppearance.subscribe((s, prev) => s.settings.user_audio !== prev.settings.user_audio && applyVolumes())

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

  const announce = (): void => {
    const { phase, channelId, muted, deafened, camera, screen, allowed } = get()
    const inCall = phase !== 'idle' && channelId
    sendRealtime(
      'voice.update',
      inCall ? { channel_id: channelId, muted: muted || !allowed.mic, deafened, camera, screen } : { channel_id: null }
    )
  }

  const reset = (error: string | null = null): void => {
    room = null
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
      error
    })
    bump()
  }

  function wire(r: Room): void {
    const isCurrent = (): boolean => room === r
    r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant) => {
      if (track.kind === Track.Kind.Audio) {
        audioSink.appendChild(track.attach())
        ;(track as RemoteAudioTrack).setVolume(volumeFor(participant.identity, track.source))
      }
      bump()
    })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove())
        bump()
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => set({ speaking: speakers.map((p) => p.identity) }))
      .on(RoomEvent.Reconnecting, () => isCurrent() && set({ phase: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => isCurrent() && set({ phase: 'connected' }))
      .on(RoomEvent.ParticipantConnected, () => isCurrent() && playSound('user-join', { fromOthers: true }))
      .on(RoomEvent.ParticipantDisconnected, () => isCurrent() && playSound('user-leave', { fromOthers: true }))
      .on(RoomEvent.TrackPublished, (pub) => {
        if (isCurrent() && pub.source === Track.Source.ScreenShare) playSound('screen-share', { fromOthers: true })
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
  }

  /** Publishes or mutes the mic to match the muted/deafened flags. */
  async function applyMic(): Promise<void> {
    const r = room
    const { muted, deafened, allowed } = get()
    if (r && r.state === ConnectionState.Connected) {
      await r.localParticipant.setMicrophoneEnabled(!muted && !deafened && allowed.mic).catch(() => {
        set({ muted: true, error: 'Não foi possível acessar o microfone.' })
      })
      await syncNoiseFilter(r)
    }
    announce()
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
        audioCaptureDefaults: {
          deviceId: prefs.audioInput || undefined,
          noiseSuppression: prefs.noiseSuppression,
          echoCancellation: true,
          autoGainControl: true
        },
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
        await r.connect(url, token)
      } catch {
        if (room === r) {
          await r.disconnect()
          reset('Não foi possível entrar no canal de voz.')
        }
        return
      }
      if (room !== r) return // left while connecting

      set({ phase: 'connected' })
      playSound('call-join')
      announce()
      // With webAudioMix the output device is set on the room's AudioContext.
      if (prefs.audioOutput) await r.switchActiveDevice('audiooutput', prefs.audioOutput).catch(() => {})
      try {
        await r.localParticipant.setMicrophoneEnabled(!get().muted && !get().deafened && get().allowed.mic)
        await syncNoiseFilter(r)
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
      stopThumbnails = startThumbnails(video, (image) => sendRealtime('screen.thumbnail', { image }))
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
        set({ screen: false })
        announce()
      }
      bump()
    },

    setScreenVolume: (identity, volume) => {
      set((s) => ({ screenVolume: { ...s.screenVolume, [identity]: volume } }))
      applyVolumes()
    },

    setModeration: (serverMuted, serverDeafened) => {
      if (serverMuted === get().serverMuted && serverDeafened === get().serverDeafened) return
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
      // Restart the mic so a new device and the browser's noise-suppression setting take effect.
      if (r.localParticipant.isMicrophoneEnabled) {
        await r.localParticipant.setMicrophoneEnabled(false)
        await r.localParticipant
          .setMicrophoneEnabled(true, {
            deviceId: prefs.audioInput || undefined,
            noiseSuppression: prefs.noiseSuppression,
            echoCancellation: true,
            autoGainControl: true
          })
          .catch(() => set({ error: 'Não foi possível usar esse microfone.' }))
      }
      await syncNoiseFilter(r)
      bump()
    },

    announce,
    clearError: () => set({ error: null })
  }

})

/** Remote/local camera track of a participant, if it's on. */
export function cameraTrackOf(identity: string): Track | undefined {
  const r = room
  if (!r) return undefined
  const p = identity === r.localParticipant.identity ? r.localParticipant : r.remoteParticipants.get(identity)
  const pub = p?.getTrackPublication(Track.Source.Camera) as RemoteTrackPublication | undefined
  return pub && !pub.isMuted ? pub.track : undefined
}

/** Screen-share video of a participant, if they're sharing. */
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
