import { create } from 'zustand'

import { api } from '../../lib/api'

export interface NotesPage {
  content: string
  /** Bumped on every save; a save must say which version it was based on. */
  version: number
  updated_by: string | null
  updated_at: string | null
}

interface NotesState {
  /** By channel id. */
  pages: Record<string, NotesPage>
  load(channelId: string): Promise<void>
  save(channelId: string, content: string, version: number): Promise<NotesPage>
  apply(channelId: string, page: NotesPage): void
}

const path = (channelId: string): string => `/addons/notes/channels/${channelId}`

export const useNotes = create<NotesState>()((set, get) => ({
  pages: {},

  load: async (channelId) => get().apply(channelId, await api<NotesPage>(path(channelId))),

  save: async (channelId, content, version) => {
    const page = await api<NotesPage>(path(channelId), { method: 'PUT', body: { content, version } })
    get().apply(channelId, page)
    return page
  },

  // Events can arrive out of order with our own saves: never go back to an older version.
  apply: (channelId, page) =>
    set((s) => {
      const current = s.pages[channelId]
      if (current && current.version > page.version) return s
      const { content, version, updated_by, updated_at } = page
      return { pages: { ...s.pages, [channelId]: { content, version, updated_by, updated_at } } }
    })
}))
