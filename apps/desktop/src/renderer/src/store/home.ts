import { create } from 'zustand'

import { agendaPath, api, type AgendaItem, type Call, type Channel, type Dm, type Friend, type HomeData, type HomeTask, type Message, type ServerDetail, type VoiceState } from '../lib/api'
import { channelPermissions, has, Perm } from '../lib/permissions'
import type { ServerEvent } from '../lib/realtime'
import { useAppearance } from './appearance'
import { useChat } from './chat'
import { useSocial } from './social'

/**
 * The Home hub's own data: message previews for "Pra você ver", "Minhas tarefas" and each
 * server's latest activity, loaded with GET /users/me/home when the hub opens and kept fresh by
 * events while it's open. Everything else on the hub (live rooms, friends, servers, read
 * counters, friend requests, missed calls) comes from the chat and social stores, which are
 * already loaded and live. See docs/decisions/0022-home-hub.md.
 */

/** Addon changes come in bursts (dragging cards around): tasks are refetched once after them. */
const TASKS_REFRESH_MS = 1000

interface HomeState {
  loaded: boolean
  /** Unread mentions of me (message previews), newest first. */
  mentions: { serverId: string; message: Message }[]
  /** The newest unread message from someone else, per DM or group. */
  dmPreviews: Record<string, Message>
  tasks: HomeTask[]
  tasksTotal: number
  /** Today's events (in my zone) I said Vou or Talvez to, not over yet. */
  todayEvents: AgendaItem[]
  /** Newest message I can see per server (ISO time). */
  activity: Record<string, string | null>

  /** The hub opened: loads its data and listens to events until `close`. */
  open(): void
  close(): void
  load(): Promise<void>
  /** All of my tasks, for "Ver todas". */
  loadAllTasks(): Promise<HomeTask[]>
  /** "Marcar tudo como lido": mentions and unread DMs. */
  markAllRead(): Promise<void>
  applyEvent(event: ServerEvent): void
}

let openCount = 0
let tasksTimer: ReturnType<typeof setTimeout> | undefined

export const useHome = create<HomeState>()((set, get) => {
  const loadToday = async (): Promise<void> => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    const items = await api<AgendaItem[]>(agendaPath(start, end, { mine: 'true' }))
    set({ todayEvents: items.filter((i) => i.kind === 'event') })
  }

  const refreshTasks = (): void => {
    clearTimeout(tasksTimer)
    tasksTimer = setTimeout(() => {
      api<HomeTask[]>('/users/me/tasks').then(
        (tasks) => openCount > 0 && set({ tasks, tasksTotal: tasks.length }),
        () => {}
      )
    }, TASKS_REFRESH_MS)
  }

  return {
    loaded: false,
    mentions: [],
    dmPreviews: {},
    tasks: [],
    tasksTotal: 0,
    todayEvents: [],
    activity: {},

    open: () => {
      openCount++
      void get().load().catch(() => {})
    },

    close: () => {
      openCount = Math.max(0, openCount - 1)
      if (openCount === 0) clearTimeout(tasksTimer)
    },

    load: async () => {
      // Apart: an older API without the agenda leaves it empty, the rest still loads.
      void loadToday().catch(() => {})
      const data = await api<HomeData>('/users/me/home')
      set({
        loaded: true,
        mentions: data.mentions.map((m) => ({ serverId: m.server_id, message: m.message })),
        dmPreviews: Object.fromEntries(data.dms.map((d) => [d.channel_id, d.message])),
        tasks: data.tasks,
        tasksTotal: data.tasks_total,
        activity: Object.fromEntries(data.servers.map((s) => [s.id, s.last_activity_at]))
      })
    },

    loadAllTasks: () => api<HomeTask[]>('/users/me/tasks'),

    markAllRead: async () => {
      const states = await api<{ channel_id: string; last_read_message_id: number; unread_count: number; mention_count: number }[]>(
        '/users/me/home/read',
        { method: 'POST' }
      )
      useChat.getState().mergeReads(states)
      set({ mentions: [], dmPreviews: {} })
      useSocial.getState().loadMissed()
    },

    applyEvent: ({ type, data }) => {
      // While the hub is closed nothing here is on screen; it reloads when it opens.
      if (openCount === 0) return
      const meId = useChat.getState().meId
      switch (type) {
        case 'ready':
        case 'server.permissions.updated':
          // Reconnected, or what we can see changed: start over.
          void get().load().catch(() => {})
          break

        case 'message.created': {
          const { mentions, server_id: serverId, ...message } = data as Message & { server_id: string | null; mentions?: string[] }
          if (serverId) set((s) => ({ activity: { ...s.activity, [serverId]: message.created_at } }))
          if (!message.author || message.author.id === meId) break
          if (serverId && meId && mentions?.includes(meId)) {
            set((s) => ({ mentions: [{ serverId, message }, ...s.mentions] }))
          } else if (!serverId) {
            set((s) => ({ dmPreviews: { ...s.dmPreviews, [message.channel_id]: message } }))
          }
          break
        }
        case 'message.updated':
          set((s) => ({
            mentions: s.mentions.map((m) => (m.message.id === data.id ? { ...m, message: { ...m.message, ...data } } : m)),
            dmPreviews:
              s.dmPreviews[data.channel_id]?.id === data.id
                ? { ...s.dmPreviews, [data.channel_id]: { ...s.dmPreviews[data.channel_id], ...data } }
                : s.dmPreviews
          }))
          break
        case 'read.updated': {
          // Read (here or on another device): previews up to that point are done.
          const read = (m: Message): boolean => m.channel_id === data.channel_id && m.id <= data.last_read_message_id
          set((s) => {
            const dmPreviews = { ...s.dmPreviews }
            const preview = dmPreviews[data.channel_id]
            if (preview && read(preview)) delete dmPreviews[data.channel_id]
            return { mentions: s.mentions.filter((m) => !read(m.message)), dmPreviews }
          })
          break
        }
        case 'message.deleted':
          set((s) => ({ mentions: s.mentions.filter((m) => m.message.id !== data.id) }))
          // The conversation's newest unread message is now an older one: ask again.
          if (get().dmPreviews[data.channel_id]?.id === data.id) void get().load().catch(() => {})
          break

        default:
          if (type.startsWith('addon.events.')) void loadToday().catch(() => {})
          else if (type.startsWith('addon.')) refreshTasks()
      }
    }
  }
})

// --- What the hub shows, from all stores ---------------------------------------

export type PendingItem =
  | { kind: 'mention'; key: string; at: string; server: ServerDetail; message: Message }
  | { kind: 'dm'; key: string; at: string; dm: Dm; unread: number; message: Message }
  | { kind: 'missed_call'; key: string; at: string; dm: Dm | undefined; call: Call }
  | { kind: 'friend_request'; key: string; at: string; friend: Friend }
  | { kind: 'event'; key: string; at: string; event: AgendaItem }

interface PendingSources {
  mentions: HomeState['mentions']
  dmPreviews: HomeState['dmPreviews']
  servers: Record<string, ServerDetail>
  reads: Record<string, { unread_count: number; mention_count: number } | undefined>
  dms: Record<string, Dm>
  friends: Record<string, Friend>
  missed: Call[]
  muted: string[]
  /** Today's events of mine (the hub drops the ones already over). */
  events?: AgendaItem[]
  now?: number
}

/**
 * "Pra você ver", newest first. A mention shows while its channel still has unread mentions
 * (reading it clears them all), and a DM while it has unread messages; their counters come from
 * the chat store, so reading anywhere updates the hub. A DM whose newest message is a call line
 * shows as the missed call instead.
 */
export function pendingItems(src: PendingSources): PendingItem[] {
  const items: PendingItem[] = []
  for (const { serverId, message } of src.mentions) {
    const server = src.servers[serverId]
    if (!server?.channels.some((c) => c.id === message.channel_id)) continue
    if (!src.reads[message.channel_id]?.mention_count) continue
    items.push({ kind: 'mention', key: `m:${message.id}`, at: message.created_at, server, message })
  }
  for (const [channelId, message] of Object.entries(src.dmPreviews)) {
    const dm = src.dms[channelId]
    const unread = src.reads[channelId]?.unread_count ?? 0
    if (!dm || unread === 0 || message.call || src.muted.includes(channelId)) continue
    items.push({ kind: 'dm', key: `d:${channelId}`, at: message.created_at, dm, unread, message })
  }
  for (const call of src.missed) {
    items.push({ kind: 'missed_call', key: `c:${call.id}`, at: call.started_at, dm: src.dms[call.channel_id], call })
  }
  for (const friend of Object.values(src.friends)) {
    if (friend.kind === 'incoming') items.push({ kind: 'friend_request', key: `f:${friend.user.id}`, at: friend.since, friend })
  }
  const now = src.now ?? Date.now()
  const events = (src.events ?? [])
    .filter((e) => e.starts_at && new Date(e.ends_at ?? e.starts_at).getTime() > now)
    .sort((a, b) => a.starts_at!.localeCompare(b.starts_at!))
    .map((event): PendingItem => ({ kind: 'event', key: `e:${event.id}`, at: event.starts_at!, event }))
  // Today's events first, soonest first; then the rest, newest first.
  return [...events, ...items.sort((a, b) => b.at.localeCompare(a.at))]
}

export function usePendingItems(): PendingItem[] {
  const mentions = useHome((s) => s.mentions)
  const dmPreviews = useHome((s) => s.dmPreviews)
  const servers = useChat((s) => s.servers)
  const reads = useChat((s) => s.reads)
  const dms = useSocial((s) => s.dms)
  const friends = useSocial((s) => s.friends)
  const missed = useSocial((s) => s.missed)
  const muted = useAppearance((s) => s.settings.muted_places)
  const events = useHome((s) => s.todayEvents)
  return pendingItems({ mentions, dmPreviews, servers, reads, dms, friends, missed, muted, events })
}

/** Friends in a call right now: in a room of a shared server I can see, or in a call with me. */
export function friendsInCall(friends: Record<string, Friend>, servers: Record<string, ServerDetail>, dms: Record<string, Dm>): Set<string> {
  const states = [...Object.values(servers).flatMap((s) => s.voice_states), ...Object.values(dms).flatMap((d) => d.voice_states)]
  return new Set(states.map((v) => v.user_id).filter((id) => friends[id]?.kind === 'friend'))
}

/** A room with people in it, or a call in one of my conversations. */
export type LiveRoom = {
  key: string
  states: VoiceState[]
  /** Friends of mine among them. */
  friends: number
  /** When the first person still there arrived (null if unknown). */
  since: string | null
} & ({ kind: 'room'; server: ServerDetail; channel: Channel } | { kind: 'call'; dm: Dm })

const earliest = (states: VoiceState[]): string | null =>
  states.reduce<string | null>((min, v) => (v.joined_at && (!min || v.joined_at < min) ? v.joined_at : min), null)

/**
 * "Ao vivo agora": server rooms with people that I can see and join (VIEW_CHANNEL comes with the
 * server's data, CONNECT is checked here), and calls going on in my DMs and groups. Rooms with
 * friends first, then the busiest.
 */
export function liveRooms(
  servers: Record<string, ServerDetail>,
  dms: Record<string, Dm>,
  friends: Record<string, Friend>,
  meId: string
): LiveRoom[] {
  const friendsIn = (states: VoiceState[]): number => states.filter((v) => friends[v.user_id]?.kind === 'friend').length
  const rooms: LiveRoom[] = []
  for (const server of Object.values(servers)) {
    for (const channel of server.channels) {
      if (channel.type !== 'voice') continue
      const states = server.voice_states.filter((v) => v.channel_id === channel.id)
      if (!states.length || !has(channelPermissions(server, channel, meId), Perm.CONNECT)) continue
      rooms.push({ kind: 'room', key: channel.id, server, channel, states, friends: friendsIn(states), since: earliest(states) })
    }
  }
  for (const dm of Object.values(dms)) {
    if (!dm.call || !dm.voice_states.length) continue
    rooms.push({ kind: 'call', key: dm.id, dm, states: dm.voice_states, friends: friendsIn(dm.voice_states), since: earliest(dm.voice_states) })
  }
  return rooms.sort(
    (a, b) => Number(b.friends > 0) - Number(a.friends > 0) || b.states.length - a.states.length || b.friends - a.friends
  )
}
