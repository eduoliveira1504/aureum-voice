import { create } from 'zustand'

import { api, type Channel, type Member, type Message, type Server, type ServerDetail } from '../lib/api'
import type { ConnectionStatus, ServerEvent } from '../lib/realtime'
import { useVoice } from './voice'

const PAGE_SIZE = 50

interface ChannelMessages {
  items: Message[]
  hasMore: boolean
  loading: boolean
  loaded: boolean
}

const EMPTY_CHANNEL: ChannelMessages = { items: [], hasMore: false, loaded: false, loading: false }

interface ChatState {
  meId: string | null
  status: ConnectionStatus
  loaded: boolean
  servers: Record<string, ServerDetail>
  order: string[]
  selectedServerId: string | null
  selectedChannelByServer: Record<string, string>
  messages: Record<string, ChannelMessages>

  reset(meId: string | null): void
  setStatus(status: ConnectionStatus): void
  loadServers(): Promise<void>
  selectServer(id: string): void
  selectChannel(serverId: string, channelId: string): void
  loadMessages(channelId: string, older?: boolean): Promise<void>
  sendMessage(channelId: string, content: string): Promise<void>
  editMessage(id: number, content: string): Promise<void>
  deleteMessage(id: number): Promise<void>
  addServer(server: ServerDetail): void
  applyEvent(event: ServerEvent): void
}

const byPosition = (a: Channel, b: Channel): number => a.position - b.position || (a.name ?? '').localeCompare(b.name ?? '')

function withSortedChannels(server: ServerDetail): ServerDetail {
  return { ...server, channels: [...server.channels].sort(byPosition) }
}

export function defaultChannel(server: ServerDetail): Channel | undefined {
  return server.channels.find((c) => c.type === 'text') ?? server.channels[0]
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
  selectedServerId: null,
  selectedChannelByServer: {},
  messages: {}
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
      const order = st.order.filter((x) => x !== id)
      return {
        servers,
        order,
        selectedServerId: st.selectedServerId === id ? (order[0] ?? null) : st.selectedServerId
      }
    })
  }

  const patchMessages = (channelId: string, fn: (items: Message[]) => Message[]): void =>
    set((st) => {
      const cur = st.messages[channelId]
      if (!cur?.loaded) return {} // not open yet: it will be fetched fresh when opened
      return { messages: { ...st.messages, [channelId]: { ...cur, items: fn(cur.items) } } }
    })

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
        const order = list.map((s) => s.id)
        const selectedServerId =
          st.selectedServerId && servers[st.selectedServerId] ? st.selectedServerId : (order[0] ?? null)
        return { servers, order, selectedServerId, loaded: true }
      })
    },

    selectServer: (id) => set({ selectedServerId: id }),

    selectChannel: (serverId, channelId) =>
      set((st) => ({ selectedChannelByServer: { ...st.selectedChannelByServer, [serverId]: channelId } })),

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

    addServer: (server) => {
      serverMutations++
      set((st) => ({
        servers: { ...st.servers, [server.id]: withSortedChannels(server) },
        order: st.order.includes(server.id) ? st.order : [...st.order, server.id],
        selectedServerId: server.id
      }))
    },

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

        case 'message.created':
        case 'message.updated':
          patchMessages(data.channel_id, (items) => mergeMessages(items, [data]))
          break
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
                  ? { ...s, members: s.members.map((m) => (m.user.id === data.user_id ? { ...m, online: data.online } : m)) }
                  : s
              ])
            )
          }))
          break
      }
    }
  }
})
