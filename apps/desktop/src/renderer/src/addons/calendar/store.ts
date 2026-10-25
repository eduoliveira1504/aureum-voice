import { create } from 'zustand'

import { api, type AgendaItem } from '../../lib/api'

export interface AgendaSource {
  channel_id: string
  channel_name: string
  addon_key: string
}

interface CalendarData {
  items: AgendaItem[]
  sources: AgendaSource[]
}

interface Loaded extends CalendarData {
  start: string
  end: string
}

export const calendarPath = (channelId: string, start: Date, end: Date): string =>
  `/addons/calendar/channels/${channelId}/items?${new URLSearchParams({ start: start.toISOString(), end: end.toISOString() })}`

// Addon events that may change what a calendar shows (a due date, an event's time...).
const RELEVANT = /^addon\.(kanban\.(card|cards|column)|events\.event)\./
const REFRESH_MS = 400

let refreshTimer: ReturnType<typeof setTimeout> | undefined

interface CalendarState {
  /** What each calendar channel shows now, with the range it was asked for. */
  views: Record<string, Loaded>
  load(channelId: string, start: Date, end: Date): Promise<void>
  /** Reloads every calendar on screen, shortly after a change that may move its items. */
  onEvent(type: string): void
}

export const useCalendar = create<CalendarState>()((set, get) => ({
  views: {},

  load: async (channelId, start, end) => {
    const data = await api<CalendarData>(calendarPath(channelId, start, end))
    set((s) => ({ views: { ...s.views, [channelId]: { ...data, start: start.toISOString(), end: end.toISOString() } } }))
  },

  onEvent: (type) => {
    if (type !== 'ready' && !RELEVANT.test(type)) return
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      for (const [channelId, view] of Object.entries(get().views)) {
        void get().load(channelId, new Date(view.start), new Date(view.end)).catch(() => {})
      }
    }, REFRESH_MS)
  }
}))
