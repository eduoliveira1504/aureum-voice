import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type RemoteTrack,
  type RemoteTrackPublication
} from 'livekit-client'
import { create } from 'zustand'

import { api } from '../lib/api'
import { loadMediaPrefs } from '../lib/mediaPrefs'
import { sendRealtime } from '../lib/realtime'

type Phase = 'idle' | 'connecting' | 'connected' | 'reconnecting'

interface VoiceStore {
  phase: Phase
  serverId: string | null
  channelId: string | null
  error: string | null
  muted: boolean
  deafened: boolean
  camera: boolean
  /** Identities (user ids) currently speaking. */
  speaking: string[]
  /** Bumped on any participant/track change so views re-read the room. */
  version: number

  join(serverId: string, channelId: string): Promise<void>
  leave(): Promise<void>
  toggleMute(): Promise<void>
  toggleDeafen(): void
  toggleCamera(): Promise<void>
  applyDevicePrefs(): Promise<void>
  /** Re-sends our voice state (after the WebSocket reconnects). */
  announce(): void
  clearError(): void
}

// The LiveKit room lives outside the store: it's a mutable object, not state.
let room: Room | null = null
// Remote audio is played through elements we own, so deafen is just `muted` on them.
const audioSink = document.createElement('div')
audioSink.hidden = true
document.body.appendChild(audioSink)

export function getRoom(): Room | null {
  return room
}

export const useVoice = create<VoiceStore>()((set, get) => {
  const bump = (): void => set((s) => ({ version: s.version + 1 }))

  const announce = (): void => {
    const { phase, channelId, muted, deafened, camera } = get()
    const inCall = phase !== 'idle' && channelId
    sendRealtime(
      'voice.update',
      inCall ? { channel_id: channelId, muted, deafened, camera, screen: false } : { channel_id: null }
    )
  }

  const reset = (error: string | null = null): void => {
    room = null
    audioSink.replaceChildren()
    set({ phase: 'idle', serverId: null, channelId: null, camera: false, speaking: [], error })
    bump()
  }

  function wire(r: Room): void {
    const isCurrent = (): boolean => room === r
    r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach()
        el.muted = get().deafened
        audioSink.appendChild(el)
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
    const { muted, deafened } = get()
    if (r && r.state === ConnectionState.Connected) {
      await r.localParticipant.setMicrophoneEnabled(!muted && !deafened).catch(() => {
        set({ muted: true, error: 'Não foi possível acessar o microfone.' })
      })
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
    speaking: [],
    version: 0,

    join: async (serverId, channelId) => {
      if (get().channelId === channelId && get().phase !== 'idle') return
      if (room) await get().leave()

      set({ phase: 'connecting', serverId, channelId, error: null, camera: false })
      const prefs = loadMediaPrefs()
      const r = new Room({
        adaptiveStream: true,
        dynacast: true,
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
        await r.localParticipant.setMicrophoneEnabled(!get().muted && !get().deafened)
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
      const { muted, deafened } = get()
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
      try {
        await r.localParticipant.setCameraEnabled(next)
        set({ camera: next })
      } catch {
        set({ camera: false, error: 'Não foi possível ligar a câmera. Confira as Configurações.' })
      }
      announce()
      bump()
    },

    applyDevicePrefs: async () => {
      const r = room
      if (!r) return
      const prefs = loadMediaPrefs()
      if (prefs.audioOutput) await r.switchActiveDevice('audiooutput', prefs.audioOutput).catch(() => {})
      if (get().camera && prefs.videoInput) await r.switchActiveDevice('videoinput', prefs.videoInput).catch(() => {})
      // Restart the mic so a new device and/or noise-suppression setting take effect.
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

/** Participants currently in the room (local first), or [] when not in a call. */
export function roomIdentities(): string[] {
  const r = room
  if (!r) return []
  return [r.localParticipant.identity, ...r.remoteParticipants.keys()]
}
