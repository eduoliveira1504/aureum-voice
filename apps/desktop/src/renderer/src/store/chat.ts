import { create } from 'zustand'

import { api, type Channel, type Member, type Message, type ReadState, type Server, type ServerDetail } from '../lib/api'
import type { ConnectionStatus, ServerEvent } from '../lib/realtime'
import { useNav } from './nav'
import { useVoice } from './voice'

const PAGE_SIZE = 50

interface ChannelMessages {
  items: Message[]
  hasMore: boolean
  loading: boolean
  loaded: boolean
}

const EMPTY_CHANNEL: ChannelMessages = { items: [], hasMore: false, loaded: false, loading: false }

// Text channels on screen right now (open in a visible panel): new messages there are read
// as they arrive instead of bumping the unread badge.
const viewing = new Map<string, number>()

/** Registers a channel as on screen; returns the cleanup. */
export function viewChannel(channelId: string): () => void {
  viewing.set(channelId, (viewing.get(channelId) ?? 0) + 1)
  return () => {
    const n = (viewing.get(channelId) ?? 1) - 1
    if (n > 0) viewing.set(channelId, n)
    else viewing.delete(channelId)
  }
}

interface ChatState {
  meId: string | null
  status: ConnectionStatus
  loaded: boolean
  servers: Record<string, ServerDetail>
  /** Server ids in join order. */
  order: string[]
  messages: Record<string, ChannelMessages>
  /** Unread/mention counters per text channel id. */
  reads: Record<string, ReadState>

  reset(meId: string | null): void
  setStatus(status: ConnectionStatus): void
  loadServers(): Promise<void>
  loadMessages(channelId: string, older?: boolean): Promise<void>
  sendMessage(channelId: string, content: string): Promise<void>
  editMessage(id: number, content: string): Promise<void>
  deleteMessage(id: number): Promise<void>
  /**
   * Marks a channel read up to its newest message. Skips the request when the counters are
   * already zero, unless `force` (a message just arrived in a channel on screen).
   */
  markRead(channelId: string, force?: boolean): void
  addServer(server: ServerDetail): void
  /** Adds read states loaded elsewhere (DMs come with the social store). */
  mergeReads(states: ReadState[]): void
  applyEvent(event: ServerEvent): void
}

const byPosition = (a: Channel, b: Channel): number => a.position - b.position || (a.name ?? '').localeCompare(b.name ?? '')

function withSortedChannels(server: ServerDetail): ServerDetail {
  return { ...server, channels: [...server.channels].sort(byPosition) }
}

function mergeMessages(...lists: Message[][]): Message[] {
  const map = new Map<number, Message>()
  for (const list of lists) for (const m of list) map.set(m.id, m)
  return [...map.values()].sort((a, b) => a.id - b.id)
}

const initial = {
  meId: null,
  status: 'connecting' as ConnectionStatus,
  loaded: false,
  servers: {},
  order: [],
  messages: {},
  reads: {}
}

export const useChat = create<ChatState>()((set, get) => {
  // Counts local changes to the server list, so a slow loadServers() never overwrites them
  // with a response that was requested before they happened.
  let serverMutations = 0

  /** Applies a change to one server if it is loaded. */
  const patchServer = (id: string, fn: (s: ServerDetail) => ServerDetail): void => {
    serverMutations++
    set((st) => (st.servers[id] ? { servers: { ...st.servers, [id]: fn(st.servers[id]) } } : {}))
  }

  const removeServer = (id: string): void => {
    serverMutations++
    if (useVoice.getState().serverId === id) void useVoice.getState().leave()
    set((st) => {
      const servers = { ...st.servers }
      delete servers[id]
      return { servers, order: st.order.filter((x) => x !== id) }
    })
  }

  const patchMessages = (channelId: string, fn: (items: Message[]) => Message[]): void =>
    set((st) => {
      const cur = st.messages[channelId]
      if (!cur?.loaded) return {} // not open yet: it will be fetched fresh when opened
      return { messages: { ...st.messages, [channelId]: { ...cur, items: fn(cur.items) } } }
    })

  const setRead = (state: ReadState): void => set((st) => ({ reads: { ...st.reads, [state.channel_id]: state } }))

  const readsOf = (details: ServerDetail[]): Record<string, ReadState> =>
    Object.fromEntries(details.flatMap((d) => d.reads.map((r) => [r.channel_id, r])))

  const upsertMember = (serverId: string, member: Member): void =>
    patchServer(serverId, (s) => ({
      ...s,
      members: [...s.members.filter((m) => m.user.id !== member.user.id), member]
    }))

  return {
    ...initial,

    reset: (meId) => set({ ...initial, meId }),
    setStatus: (status) => set({ status }),

    loadServers: async () => {
      let list: Server[]
      let details: ServerDetail[]
      for (;;) {
        const startedAt = serverMutations
        list = await api<Server[]>('/servers')
        details = await Promise.all(list.map((s) => api<ServerDetail>(`/servers/${s.id}`)))
        if (startedAt === serverMutations) break // otherwise refetch for a consistent view
      }
      set((st) => {
        const servers = Object.fromEntries(details.map((d) => [d.id, withSortedChannels(d)]))
        // Merged, not replaced: DM read states are loaded by the social store.
        return { servers, order: list.map((s) => s.id), reads: { ...st.reads, ...readsOf(details) }, loaded: true }
      })
    },

    loadMessages: async (channelId, older = false) => {
      const cur = get().messages[channelId]
      if (cur?.loading || (older && !cur?.hasMore)) return
      const setEntry = (entry: Partial<ChannelMessages>): void =>
        set((st) => ({
          messages: {
            ...st.messages,
            [channelId]: { ...EMPTY_CHANNEL, ...st.messages[channelId], ...entry }
          }
        }))

      setEntry({ loading: true })
      try {
        const before = older && cur?.items[0] ? `&before=${cur.items[0].id}` : ''
        const page = await api<Message[]>(`/channels/${channelId}/messages?limit=${PAGE_SIZE}${before}`)
        const prev = older ? (get().messages[channelId]?.items ?? []) : []
        setEntry({ items: mergeMessages(page, prev), hasMore: page.length === PAGE_SIZE, loaded: true, loading: false })
      } catch (err) {
        setEntry({ loading: false })
        throw err
      }
    },

    sendMessage: async (channelId, content) => {
      const message = await api<Message>(`/channels/${channelId}/messages`, { method: 'POST', body: { content } })
      patchMessages(channelId, (items) => mergeMessages(items, [message]))
    },

    editMessage: async (id, content) => {
      const message = await api<Message>(`/messages/${id}`, { method: 'PATCH', body: { content } })
      patchMessages(message.channel_id, (items) => mergeMessages(items, [message]))
    },

    deleteMessage: async (id) => {
      await api(`/messages/${id}`, { method: 'DELETE' })
      for (const channelId of Object.keys(get().messages)) {
        patchMessages(channelId, (items) => items.filter((m) => m.id !== id))
      }
    },

    markRead: (channelId, force = false) => {
      const cur = get().reads[channelId]
      if (!force && cur && cur.unread_count === 0 && cur.mention_count === 0) return
      if (cur) setRead({ ...cur, unread_count: 0, mention_count: 0 })
      api<ReadState>(`/channels/${channelId}/read`, { method: 'POST' }).then(setRead, () => {})
    },

    addServer: (server) => {
      serverMutations++
      set((st) => ({
        reads: { ...st.reads, ...readsOf([server]) },
        servers: { ...st.servers, [server.id]: withSortedChannels(server) },
        order: st.order.includes(server.id) ? st.order : [...st.order, server.id]
      }))
    },

    mergeReads: (states) =>
      set((st) => ({ reads: { ...st.reads, ...Object.fromEntries(states.map((r) => [r.channel_id, r])) } })),

    applyEvent: ({ type, data }) => {
      const { meId } = get()
      switch (type) {
        case 'ready':
          // (Re)connected: refetch so nothing missed while offline is lost, and tell the
          // server we're still in a call (it drops voice state when connections close).
          set({ messages: {} })
          void get().loadServers()
          useVoice.getState().announce()
          break

        case 'message.created': {
          const { mentions, server_id: _, ...message } = data
          patchMessages(data.channel_id, (items) => mergeMessages(items, [message]))
          if (message.author?.id === meId) break
          if (viewing.has(data.channel_id)) {
            get().markRead(data.channel_id, true)
            break
          }
          const cur = get().reads[data.channel_id] ?? {
            channel_id: data.channel_id,
            last_read_message_id: 0,
            unread_count: 0,
            mention_count: 0
          }
          setRead({
            ...cur,
            unread_count: cur.unread_count + 1,
            mention_count: cur.mention_count + (meId && mentions?.includes(meId) ? 1 : 0)
          })
          break
        }
        case 'message.updated':
          patchMessages(data.channel_id, (items) => mergeMessages(items, [data]))
          break
        case 'read.updated': {
          const { server_id: _, ...state } = data
          setRead(state)
          break
        }
        case 'message.deleted':
          patchMessages(data.channel_id, (items) => items.filter((m) => m.id !== data.id))
          break

        case 'channel.created':
        case 'channel.updated':
          patchServer(data.server_id, (s) => ({
            ...s,
            channels: [...s.channels.filter((c) => c.id !== data.id), data].sort(byPosition)
          }))
          break
        case 'channel.deleted':
          if (useVoice.getState().channelId === data.id) void useVoice.getState().leave()
          useNav.getState().dropChannelTab(data.server_id, data.id)
          patchServer(data.server_id, (s) => ({ ...s, channels: s.channels.filter((c) => c.id !== data.id) }))
          break

        case 'server.updated':
          patchServer(data.id, (s) => ({ ...s, ...data }))
          break
        case 'server.deleted':
          removeServer(data.id)
          break

        case 'server.member.joined':
          if (data.member.user.id === meId && !get().servers[data.server_id]) {
            void get().loadServers() // joined from another device
          } else {
            upsertMember(data.server_id, data.member)
          }
          break
        case 'server.member.left':
          if (data.user_id === meId) removeServer(data.server_id)
          else patchServer(data.server_id, (s) => ({ ...s, members: s.members.filter((m) => m.user.id !== data.user_id) }))
          break

        case 'user.updated': {
          // Someone's profile changed: refresh it in member lists and loaded messages.
          serverMutations++
          const swap = <T extends { id: string }>(u: T): T => (u.id === data.id ? { ...u, ...data } : u)
          set((st) => ({
            servers: Object.fromEntries(
              Object.entries(st.servers).map(([id, s]) => [id, { ...s, members: s.members.map((m) => ({ ...m, user: swap(m.user) })) }])
            ),
            messages: Object.fromEntries(
              Object.entries(st.messages).map(([cid, entry]) => [
                cid,
                { ...entry, items: entry.items.map((m) => (m.author ? { ...m, author: swap(m.author) } : m)) }
              ])
            )
          }))
          break
        }

        case 'voice.state':
          patchServer(data.server_id, (s) => ({
            ...s,
            voice_states: [...s.voice_states.filter((v) => v.user_id !== data.user_id), ...(data.state ? [data.state] : [])]
          }))
          break

        case 'presence.updated':
          serverMutations++
          set((st) => ({
            servers: Object.fromEntries(
              Object.entries(st.servers).map(([id, s]) => [
                id,
                s.members.some((m) => m.user.id === data.user_id)
                  ? {
                      ...s,
                      members: s.members.map((m) => (m.user.id === data.user_id ? { ...m, online: data.online, status: data.status } : m))
                    }
                  : s
              ])
            )
          }))
          break
      }
    }
  }
})
