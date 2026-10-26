import { create } from 'zustand'

import { api, type Message, type Sticker, type StickerPack } from '../lib/api'
import type { ServerEvent } from '../lib/realtime'
import { useAppearance } from './appearance'
import { useChat } from './chat'

const MAX_RECENT = 16

interface StickersState {
  /** Aureum's packs first, then the user's servers' own (from GET /stickers; reloaded each time
   * the picker opens). */
  packs: StickerPack[]
  loaded: boolean
  load(): Promise<void>
  /** Sends a sticker as a message of its own; remembers it as recent. */
  send(channelId: string, sticker: Sticker, reply?: { id: number; mention: boolean }): Promise<Message>
  applyEvent(event: ServerEvent): void
  reset(): void
}

export const useStickers = create<StickersState>()((set, get) => ({
  packs: [],
  loaded: false,

  load: async () => {
    const packs = await api<StickerPack[]>('/stickers')
    set({ packs, loaded: true })
  },

  send: async (channelId, sticker, reply) => {
    const message = await api<Message>(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: { sticker_id: sticker.id, ...(reply && { reply_to_id: reply.id, mention_reply: reply.mention }) }
    })
    useChat.getState().addMessage(message)
    const { settings, update } = useAppearance.getState()
    update({ recent_stickers: [sticker.id, ...settings.recent_stickers.filter((id) => id !== sticker.id)].slice(0, MAX_RECENT) })
    return message
  },

  applyEvent: (event) => {
    // A server's stickers changed. (Joining or leaving servers is picked up when the picker opens.)
    if (event.type === 'stickers.updated' && get().loaded) void get().load().catch(() => {})
  },

  reset: () => set({ packs: [], loaded: false })
}))

/** Whether `sticker`'s pack lets it go in a place of `serverId` (null: a DM or group). */
export const usableIn = (pack: StickerPack, serverId: string | null): boolean => pack.is_global || pack.server_id === serverId

/** Search by name or emoji (lowercase, accents ignored). */
export function stickerMatches(sticker: Sticker, query: string): boolean {
  const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const q = fold(query.trim())
  return !q || fold(sticker.name).includes(q) || (!!sticker.emoji && query.includes(sticker.emoji))
}
