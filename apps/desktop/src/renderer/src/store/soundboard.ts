import { create } from 'zustand'

import { api, type Attachment, type Sound } from '../lib/api'
import { attachmentUrl } from '../lib/attachments'
import { loadMediaPrefs } from '../lib/mediaPrefs'
import type { ServerEvent } from '../lib/realtime'

export const MAX_SOUNDS = 24
export const MAX_SOUND_BYTES = 1024 * 1024

interface SoundboardState {
  /** Each server's sounds, by server id (loaded when its panel or settings tab opens). */
  byServer: Record<string, Sound[]>
  load(serverId: string): Promise<void>
  applyEvent(event: ServerEvent): void
  reset(): void
}

export const useSoundboard = create<SoundboardState>()((set, get) => ({
  byServer: {},

  load: async (serverId) => {
    const sounds = await api<Sound[]>(`/servers/${serverId}/sounds`)
    set((s) => ({ byServer: { ...s.byServer, [serverId]: sounds } }))
  },

  applyEvent: (event) => {
    const serverId: string | undefined = event.data?.server_id
    if (event.type === 'soundboard.updated' && serverId && get().byServer[serverId]) void get().load(serverId).catch(() => {})
  },

  reset: () => set({ byServer: {} })
}))

/** A blob URL for the sound's file. Kept like attachments: a sound's file never changes. */
export const soundUrl = (sound: Sound): Promise<string> =>
  attachmentUrl({ id: sound.id, url: sound.url, content_type: 'audio/mpeg' } as Attachment)

/** Plays a sound file only here (settings preview), at `volume` (0-100). Returns a stop function. */
export function playHere(src: string, volume: number): () => void {
  const el = new Audio(src)
  el.volume = volume / 100
  const output = loadMediaPrefs().audioOutput
  if (output) void (el as HTMLAudioElement & { setSinkId?(id: string): Promise<void> }).setSinkId?.(output).catch(() => {})
  void el.play().catch(() => {})
  return () => el.pause()
}
