import { create } from 'zustand'

import { api, type Channel, type Member, type Message, type Reaction, type ReadState, type Server, type ServerDetail } from '../lib/api'
import { stepId, withSectionOrder, type Section } from '../lib/channelOrder'
import type { ConnectionStatus, ServerEvent } from '../lib/realtime'
import { playSound } from '../lib/sounds'
import { useAppearance } from './appearance'
import { useNav } from './nav'
import { useVoice } from './voice'

const PAGE_SIZE = 50
/** Message sounds play this much quieter while we're in a call. */
const IN_CALL_MESSAGE_VOLUME = 0.4

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

/**
 * The message sound, for DMs and groups (unless silenced) and mentions anywhere. Not for the
 * conversation on screen while the app has focus, nor for the chat of the call we're in; quieter
 * during any other call.
 */
function messageSound(channelId: string, serverId: string | null, mentioned: boolean): void {
  if (!mentioned && (serverId !== null || useAppearance.getState().settings.muted_places.includes(channelId))) return
  if (viewing.has(channelId) && document.hasFocus()) return
  const voice = useVoice.getState()
  const inCall = voice.phase !== 'idle'
  if (inCall && voice.channelId === channelId) return
  playSound('message', { fromOthers: true, volume: inCall ? IN_CALL_MESSAGE_VOLUME : 1 })
}

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
  /** A message to scroll to when its channel shows up on screen (opened from Home's hub). */
  focus: { channelId: string; messageId: number } | null

  reset(meId: string | null): void
  setStatus(status: ConnectionStatus): void
  loadServers(): Promise<void>
  loadMessages(channelId: string, older?: boolean): Promise<void>
  /** Text and/or files uploaded beforehand (POST /channels/{id}/attachments); returns the message.
   * `reply` answers a message of the channel, notifying its author when `mention`. */
  sendMessage(channelId: string, content: string, attachmentIds?: string[], reply?: { id: number; mention: boolean }): Promise<Message>
  editMessage(id: number, content: string): Promise<void>
  /** The X on a link's card: takes the message's cards away (mine only). */
  removePreviews(message: Message): Promise<void>
  /** Adds (on) or takes back my reaction; shown right away, then as the API says. */
  react(message: Message, emoji: string, on: boolean): Promise<void>
  /** Takes away someone else's reaction (MANAGE_MESSAGES). */
  removeReaction(message: Message, emoji: string, userId: string): Promise<void>
  /** Sends a copy of the message to up to 5 conversations, with an optional comment. */
  forwardMessage(id: number, channelIds: string[], comment: string): Promise<void>
  deleteMessage(id: number): Promise<void>
  /**
   * Marks a channel read up to its newest message. Skips the request when the counters are
   * already zero, unless `force` (a message just arrived in a channel on screen).
   */
  markRead(channelId: string, force?: boolean): void
  /** "Marcar como não lida": the message and what came after count as unread again. */
  markUnread(channelId: string, messageId: number): Promise<void>
  addServer(server: ServerDetail): void
  /** Saves a sidebar section's order (MANAGE_CHANNELS): applied right away, then as the API says. */
  reorderChannels(serverId: string, section: Section, ids: string[]): Promise<void>
  /** Moves a channel one place up (-1) or down (+1) in its section. */
  moveChannel(serverId: string, channelId: string, delta: -1 | 1): Promise<void>
  /** Refetches one server (its roles or permissions changed: which channels we see may differ). */
  refreshServer(id: string): Promise<void>
  focusMessage(channelId: string, messageId: number): void
  clearFocus(): void
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
  for (const list of lists) {
    for (const m of list) {
      // Messages that come without reactions (new ones, addon updates) keep the ones we have.
      const known = map.get(m.id)
      map.set(m.id, m.reactions == null && known?.reactions ? { ...m, reactions: known.reactions } : m)
    }
  }
  return [...map.values()].sort((a, b) => a.id - b.id)
}

/** My reaction added (on) or taken back, before the API answers. */
export function toggleReaction(reactions: Reaction[], emoji: string, userId: string, on: boolean): Reaction[] {
  const existing = reactions.find((r) => r.emoji === emoji)
  if (on) {
    if (existing?.user_ids.includes(userId)) return reactions
    return existing
      ? reactions.map((r) => (r === existing ? { ...r, count: r.count + 1, user_ids: [...r.user_ids, userId] } : r))
      : [...reactions, { emoji, count: 1, user_ids: [userId] }]
  }
  if (!existing?.user_ids.includes(userId)) return reactions
  return reactions
    .map((r) => (r === existing ? { ...r, count: r.count - 1, user_ids: r.user_ids.filter((u) => u !== userId) } : r))
    .filter((r) => r.count > 0)
}

/** Drops a deleted message; replies to it keep its id but lose the quote ("Mensagem original apagada"). */
function withoutMessage(items: Message[], id: number): Message[] {
  return items.filter((m) => m.id !== id).map((m) => (m.reply_to?.id === id ? { ...m, reply_to: null } : m))
}

const initial = {
  meId: null,
  status: 'connecting' as ConnectionStatus,
  loaded: false,
  servers: {},
  order: [],
  messages: {},
  reads: {},
  focus: null
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

  /** New positions from the API (a reorder, ours or someone else's): applied and re-sorted. */
  const applyPositions = (serverId: string, positions: { id: string; position: number }[]): void => {
    const byId = new Map(positions.map((p) => [p.id, p.position]))
    patchServer(serverId, (s) => ({
      ...s,
      channels: s.channels.map((c) => (byId.has(c.id) ? { ...c, position: byId.get(c.id)! } : c)).sort(byPosition)
    }))
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

    sendMessage: async (channelId, content, attachmentIds = [], reply) => {
      const message = await api<Message>(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: { content, attachment_ids: attachmentIds, ...(reply && { reply_to_id: reply.id, mention_reply: reply.mention }) }
      })
      patchMessages(channelId, (items) => mergeMessages(items, [message]))
      return message
    },

    editMessage: async (id, content) => {
      const message = await api<Message>(`/messages/${id}`, { method: 'PATCH', body: { content } })
      patchMessages(message.channel_id, (items) => mergeMessages(items, [message]))
    },

    removePreviews: async (message) => {
      const updated = await api<Message>(`/messages/${message.id}/previews`, { method: 'DELETE' })
      patchMessages(updated.channel_id, (items) => mergeMessages(items, [updated]))
    },

    react: async (message, emoji, on) => {
      const { meId } = get()
      if (!meId) return
      const setReactions = (reactions: Reaction[]): void =>
        patchMessages(message.channel_id, (items) => items.map((m) => (m.id === message.id ? { ...m, reactions } : m)))
      const current = get().messages[message.channel_id]?.items.find((m) => m.id === message.id)?.reactions ?? []
      setReactions(toggleReaction(current, emoji, meId, on))
      const path = `/messages/${message.id}/reactions/${encodeURIComponent(emoji)}`
      try {
        setReactions(await api<Reaction[]>(path, { method: on ? 'PUT' : 'DELETE' }))
      } catch (err) {
        setReactions(current)
        throw err
      }
    },

    removeReaction: async (message, emoji, userId) => {
      const reactions = await api<Reaction[]>(`/messages/${message.id}/reactions/${encodeURIComponent(emoji)}/${userId}`, { method: 'DELETE' })
      patchMessages(message.channel_id, (items) => items.map((m) => (m.id === message.id ? { ...m, reactions } : m)))
    },

    forwardMessage: async (id, channelIds, comment) => {
      const sent = await api<Message[]>(`/messages/${id}/forward`, { method: 'POST', body: { channel_ids: channelIds, comment } })
      for (const message of sent) {
        if (get().messages[message.channel_id]) patchMessages(message.channel_id, (items) => mergeMessages(items, [message]))
      }
    },

    deleteMessage: async (id) => {
      await api(`/messages/${id}`, { method: 'DELETE' })
      for (const channelId of Object.keys(get().messages)) patchMessages(channelId, (items) => withoutMessage(items, id))
    },

    markRead: (channelId, force = false) => {
      const cur = get().reads[channelId]
      if (!force && cur && cur.unread_count === 0 && cur.mention_count === 0) return
      if (cur) setRead({ ...cur, unread_count: 0, mention_count: 0 })
      api<ReadState>(`/channels/${channelId}/read`, { method: 'POST' }).then(setRead, () => {})
    },

    markUnread: async (channelId, messageId) => {
      setRead(await api<ReadState>(`/channels/${channelId}/unread`, { method: 'POST', body: { message_id: messageId } }))
    },

    addServer: (server) => {
      serverMutations++
      set((st) => ({
        reads: { ...st.reads, ...readsOf([server]) },
        servers: { ...st.servers, [server.id]: withSortedChannels(server) },
        order: st.order.includes(server.id) ? st.order : [...st.order, server.id]
      }))
    },

    reorderChannels: async (serverId, section, ids) => {
      patchServer(serverId, (s) => ({ ...s, channels: withSectionOrder(s.channels, ids).sort(byPosition) }))
      try {
        const positions = await api<{ id: string; position: number }[]>(`/servers/${serverId}/channels/order`, {
          method: 'PUT',
          body: { type: section, channel_ids: ids }
        })
        applyPositions(serverId, positions)
      } catch (err) {
        void get().refreshServer(serverId) // back to the saved order
        throw err
      }
    },

    moveChannel: async (serverId, channelId, delta) => {
      const channels = get().servers[serverId]?.channels ?? []
      const channel = channels.find((c) => c.id === channelId)
      if (!channel || channel.type === 'dm' || channel.type === 'group_dm') return
      const ids = channels.filter((c) => c.type === channel.type).map((c) => c.id)
      const next = stepId(ids, channelId, delta)
      if (next !== ids) await get().reorderChannels(serverId, channel.type, next)
    },

    refreshServer: async (id) => {
      let detail: ServerDetail
      try {
        detail = await api<ServerDetail>(`/servers/${id}`)
      } catch {
        return // gone (kicked or deleted): its own event removes it
      }
      if (!get().servers[id]) return // left meanwhile
      const visible = new Set(detail.channels.map((c) => c.id))
      const hidden = (get().servers[id]?.channels ?? []).filter((c) => !visible.has(c.id)).map((c) => c.id)
      for (const channelId of hidden) useNav.getState().dropChannelTab(id, channelId)
      if (hidden.length) {
        // Nothing of a channel the user can't see anymore stays around (messages, badges).
        set((st) => ({
          messages: Object.fromEntries(Object.entries(st.messages).filter(([c]) => !hidden.includes(c))),
          reads: Object.fromEntries(Object.entries(st.reads).filter(([c]) => !hidden.includes(c)))
        }))
      }
      const voice = useVoice.getState()
      if (voice.serverId === id && voice.channelId && !visible.has(voice.channelId)) void voice.leave()
      get().addServer(detail)
    },

    focusMessage: (channelId, messageId) => set({ focus: { channelId, messageId } }),
    clearFocus: () => set({ focus: null }),

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
          // A call's line in the conversation has the ringtone instead. An official security
          // notice always sounds, even in a silenced official DM (like a mention does).
          const security = message.official?.category === 'seguranca' && !!message.author?.is_official
          if (!message.call && !message.system) messageSound(data.channel_id, data.server_id, security || (!!meId && !!mentions?.includes(meId)))
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
        case 'message.reactions':
          patchMessages(data.channel_id, (items) => items.map((m) => (m.id === data.message_id ? { ...m, reactions: data.reactions } : m)))
          break
        case 'read.updated': {
          const { server_id: _, ...state } = data
          setRead(state)
          break
        }
        case 'message.deleted':
          patchMessages(data.channel_id, (items) => withoutMessage(items, data.id))
          break

        case 'channel.created':
        case 'channel.updated':
          patchServer(data.server_id, (s) => ({
            ...s,
            channels: [...s.channels.filter((c) => c.id !== data.id), data].sort(byPosition)
          }))
          break
        case 'channels.reordered':
          applyPositions(data.server_id, data.channels)
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
        case 'server.permissions.updated':
          void get().refreshServer(data.server_id)
          break

        case 'server.member.joined':
          if (data.member.user.id === meId && !get().servers[data.server_id]) {
            void get().loadServers() // joined from another device
          } else {
            upsertMember(data.server_id, data.member)
          }
          break
        case 'server.member.updated':
          upsertMember(data.server_id, data.member)
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

        case 'voice.state': {
          patchServer(data.server_id, (s) => ({
            ...s,
            voice_states: [...s.voice_states.filter((v) => v.user_id !== data.user_id), ...(data.state ? [data.state] : [])]
          }))
          const voice = useVoice.getState()
          if (data.user_id === meId && data.state && data.server_id && voice.serverId === data.server_id) {
            voice.setModeration(!!data.state.server_muted, !!data.state.server_deafened)
          }
          break
        }
        case 'voice.moved':
          // A moderator moved us to another room of the server.
          if (useVoice.getState().serverId === data.server_id) void useVoice.getState().join(data.server_id, data.channel_id)
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
