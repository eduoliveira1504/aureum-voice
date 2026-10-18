import {
  AudioPresets,
  ConnectionState,
  Room,
  RoomEvent,
  ScreenSharePresets,
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
import { NOISE_FILTER, NoiseFilter } from '../lib/noiseFilter'
import { sendRealtime } from '../lib/realtime'
import { startThumbnails } from '../lib/thumbnail'

type Phase = 'idle' | 'connecting' | 'connected' | 'reconnecting'

export interface ScreenShareOptions {
  sourceId: string
  /** Include system audio (Windows loopback, without this app's own audio). */
  audio: boolean
  /** 'motion' favors frame rate (games, video); 'detail' favors sharpness (text, code). */
  hint: 'motion' | 'detail'
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

  /** Joins a server voice room, or a private call (serverId null, channelId = the conversation). */
  join(serverId: string | null, channelId: string): Promise<void>
  leave(): Promise<void>
  toggleMute(): Promise<void>
  toggleDeafen(): void
  toggleCamera(): Promise<void>
  startScreenShare(options: ScreenShareOptions): Promise<void>
  stopScreenShare(): Promise<void>
  setScreenVolume(identity: string, volume: number): void
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
// Remote audio is played through elements we own, so deafen is just `muted` on them.
const audioSink = document.createElement('div')
audioSink.hidden = true
document.body.appendChild(audioSink)

export function getRoom(): Room | null {
  return room
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
    set({ phase: 'idle', serverId: null, channelId: null, camera: false, screen: false, allowed: ANYTHING, speaking: [], screenVolume: {}, error })
    bump()
  }

  function wire(r: Room): void {
    const isCurrent = (): boolean => room === r
    r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach()
        el.muted = get().deafened
        audioSink.appendChild(el)
        const volume = get().screenVolume[participant.identity]
        if (track.source === Track.Source.ScreenShareAudio && volume !== undefined) {
          ;(track as RemoteAudioTrack).setVolume(volume)
        }
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
      .on(RoomEvent.Disconnected, () => {
        if (!isCurrent()) return // we left on purpose
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

    join: async (serverId, channelId) => {
      if (get().channelId === channelId && get().phase !== 'idle') return
      if (room) await get().leave()

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
        audioOutput: prefs.audioOutput ? { deviceId: prefs.audioOutput } : undefined
      })
      room = r
      wire(r)

      try {
        const { token, url } = await api<{ token: string; url: string }>(`/channels/${channelId}/voice/token`, {
          method: 'POST'
        })
        set({ allowed: publishableIn(token) })
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
      announce()
      try {
        await r.localParticipant.setMicrophoneEnabled(!get().muted && !get().deafened && get().allowed.mic)
        await syncNoiseFilter(r)
      } catch {
        set({ muted: true, error: 'Não foi possível acessar o microfone. Confira as Configurações.' })
        announce()
      }
    },

    leave: async () => {
      const r = room
      if (!r) return
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
      audioSink.querySelectorAll('audio').forEach((el) => (el.muted = false))
      await applyMic()
    },

    toggleDeafen: () => {
      const deafened = !get().deafened
      set({ deafened })
      audioSink.querySelectorAll('audio').forEach((el) => (el.muted = deafened))
      void applyMic()
    },

    toggleCamera: async () => {
      const r = room
      if (!r || get().phase === 'connecting') return
      const next = !get().camera
      if (next && !get().allowed.camera) return
      try {
        await r.localParticipant.setCameraEnabled(next)
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
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: hint === 'motion' ? 30 : 15 }, width: { max: 1920 }, height: { max: 1080 } },
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
          videoEncoding: (hint === 'motion' ? ScreenSharePresets.h1080fps30 : ScreenSharePresets.h1080fps15).encoding,
          // Lower layers for viewers watching in a side tile instead of in focus.
          simulcast: true,
          screenShareSimulcastLayers:
            hint === 'motion'
              ? [ScreenSharePresets.h360fps15, ScreenSharePresets.h720fps30]
              : [ScreenSharePresets.h360fps3, ScreenSharePresets.h720fps15],
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
      screenAudioOf(identity)?.setVolume(volume)
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
