import { create } from 'zustand'

import { api } from '../../lib/api'

export type Repeat = 'none' | 'weekly'
export type Answer = 'going' | 'maybe' | 'no'

export const ANSWER_LABEL: Record<Answer, string> = { going: 'Vou', maybe: 'Talvez', no: 'Não vou' }

export interface EventItem {
  id: string
  title: string
  description: string
  /** The first occurrence; a weekly event repeats it every week. */
  starts_at: string
  ends_at: string
  timezone: string
  repeat: Repeat
  location_channel_id: string | null
  location_text: string | null
  /** Names the current cover: fetch it with coverUrl(). */
  cover: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  cancelled_at: string | null
  /** The occurrence going on or next (or, once a one-off event is over, its only one). */
  occurrence: { index: number; starts_at: string; ends_at: string }
  over: boolean
  responses: Record<Answer, string[]>
}

interface EventList {
  events: EventItem[]
  can_manage: boolean
}

export interface EventFields {
  title: string
  description: string
  starts_at: string
  ends_at: string
  timezone: string
  repeat: Repeat
  location_channel_id: string | null
  location_text: string | null
}

export const eventsPath = (channelId: string, path = ''): string => `/addons/events/channels/${channelId}/events${path}`

export const coverUrl = (channelId: string, event: EventItem): string | null =>
  event.cover ? `/api${eventsPath(channelId, `/${event.id}/cover`)}?v=${event.cover}` : null

/** The user's own zone, for the times they pick and for repeats. */
export const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'

export function myAnswer(event: EventItem, userId: string): Answer | null {
  return (Object.keys(event.responses) as Answer[]).find((a) => event.responses[a].includes(userId)) ?? null
}

/** Coming up or going on, soonest first; then the ones over (newest first). Cancelled ones stay
 * where their date puts them. */
export function splitEvents(events: EventItem[]): { upcoming: EventItem[]; past: EventItem[] } {
  const byStart = (a: EventItem, b: EventItem): number => a.occurrence.starts_at.localeCompare(b.occurrence.starts_at)
  return {
    upcoming: events.filter((e) => !e.over).sort(byStart),
    past: events.filter((e) => e.over).sort((a, b) => byStart(b, a))
  }
}

const upsert = (events: EventItem[], event: EventItem): EventItem[] => [...events.filter((e) => e.id !== event.id), event]

interface EventsState {
  /** By channel id. */
  lists: Record<string, EventList>
  load(channelId: string): Promise<void>
  /** Applies an `addon.events.*` event. */
  apply(type: string, data: Record<string, unknown>): void
  put(channelId: string, event: EventItem): void
  create(channelId: string, fields: EventFields): Promise<EventItem>
  update(channelId: string, eventId: string, fields: Partial<EventFields>): Promise<EventItem>
  answer(channelId: string, eventId: string, answer: Answer | null): Promise<void>
  cancel(channelId: string, eventId: string): Promise<void>
  remove(channelId: string, eventId: string): Promise<void>
  setCover(channelId: string, eventId: string, file: File): Promise<void>
  removeCover(channelId: string, eventId: string): Promise<void>
}

export const useEvents = create<EventsState>()((set, get) => ({
  lists: {},

  load: async (channelId) => {
    const list = await api<EventList>(eventsPath(channelId))
    set((s) => ({ lists: { ...s.lists, [channelId]: list } }))
  },

  put: (channelId, event) =>
    set((s) => {
      const list = s.lists[channelId]
      return list ? { lists: { ...s.lists, [channelId]: { ...list, events: upsert(list.events, event) } } } : s
    }),

  apply: (type, data) => {
    const channelId = data.channel_id as string
    if (type === 'addon.events.event.deleted') {
      set((s) => {
        const list = s.lists[channelId]
        return list ? { lists: { ...s.lists, [channelId]: { ...list, events: list.events.filter((e) => e.id !== data.id) } } } : s
      })
    } else if (type === 'addon.events.event.created' || type === 'addon.events.event.updated') {
      get().put(channelId, data as unknown as EventItem)
    }
  },

  create: async (channelId, fields) => {
    const event = await api<EventItem>(eventsPath(channelId), { method: 'POST', body: fields })
    get().put(channelId, event)
    return event
  },

  update: async (channelId, eventId, fields) => {
    const event = await api<EventItem>(eventsPath(channelId, `/${eventId}`), { method: 'PATCH', body: fields })
    get().put(channelId, event)
    return event
  },

  answer: async (channelId, eventId, answer) => {
    const event = await api<EventItem>(eventsPath(channelId, `/${eventId}/response`), { method: 'PUT', body: { status: answer } })
    get().put(channelId, event)
  },

  cancel: async (channelId, eventId) => {
    get().put(channelId, await api<EventItem>(eventsPath(channelId, `/${eventId}/cancel`), { method: 'POST' }))
  },

  remove: async (channelId, eventId) => {
    await api(eventsPath(channelId, `/${eventId}`), { method: 'DELETE' })
    get().apply('addon.events.event.deleted', { channel_id: channelId, id: eventId })
  },

  setCover: async (channelId, eventId, file) => {
    const form = new FormData()
    form.append('file', file, file.name)
    get().put(channelId, await api<EventItem>(eventsPath(channelId, `/${eventId}/cover`), { method: 'PUT', body: form }))
  },

  removeCover: async (channelId, eventId) => {
    get().put(channelId, await api<EventItem>(eventsPath(channelId, `/${eventId}/cover`), { method: 'DELETE' }))
  }
}))
