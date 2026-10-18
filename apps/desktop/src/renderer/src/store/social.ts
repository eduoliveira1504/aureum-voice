import { create } from 'zustand'

import { api, type Call, type Dm, type Friend, type Presence, type User } from '../lib/api'
import type { ServerEvent } from '../lib/realtime'
import { playSound } from '../lib/sounds'
import { useAppearance } from './appearance'
import { useChat } from './chat'
import { useNav } from './nav'
import { useVoice } from './voice'

/** How long an incoming call rings before it counts as missed (the API uses the same). */
export const RING_MS = 30_000

/**
 * Home: friends, DMs and groups, the people in them (with live presence) and private calls,
 * including the one ringing right now. Messages and read state of DMs live in the chat store,
 * like any channel's.
 */

export interface Ringing {
  call: Call
  /** Local time the ring started, for the 30 s timeout. */
  since: number
}

interface SocialState {
  meId: string | null
  loaded: boolean
  /** Friends, requests and blocks, by the other user's id. */
  friends: Record<string, Friend>
  dms: Record<string, Dm>
  /** Visible status of anyone seen in Home (friends, DM and group members). */
  presence: Record<string, Presence>
  /** Calls not answered that are still unseen (their conversation is unread). */
  missed: Call[]
  ringing: Ringing | null
  /** A call that came in during Do not disturb: shown as a quiet "missed call" note, no popup. */
  missedNotice: Call | null

  reset(meId: string | null): void
  load(): Promise<void>
  loadMissed(): void
  sendRequest(username: string): Promise<Friend>
  accept(userId: string): Promise<void>
  /** Declines or cancels a request, or unfriends. */
  remove(userId: string): Promise<void>
  block(userId: string): Promise<void>
  unblock(userId: string): Promise<void>
  /** Opens (creating if needed) the DM with a friend and shows it; returns its id. */
  openDm(userId: string): Promise<string>
  createGroup(userIds: string[], name?: string): Promise<Dm>
  renameGroup(id: string, name: string | null): Promise<void>
  addMembers(id: string, userIds: string[]): Promise<void>
  /** Closes a DM (it comes back with the next message) or leaves a group. */
  closeDm(id: string): Promise<void>
  /** Starts a call in the conversation (or joins the one in progress) and enters it. */
  startCall(channelId: string): Promise<void>
  /** Rings more people; from a 1:1 DM the call moves to a new group (call.moved). */
  ringMore(callId: string, userIds: string[]): Promise<void>
  answer(): void
  decline(): void
  /** Stops ringing locally (timed out). */
  dismissRing(): void
  dismissMissedNotice(): void
  applyEvent(event: ServerEvent): void
}

const initial = {
  meId: null,
  loaded: false,
  friends: {},
  dms: {},
  presence: {},
  missed: [],
  ringing: null,
  missedNotice: null
}

/** Rung for `call` and not answered nor declined yet (the call still going). */
function unanswered(call: Call, userId: string): boolean {
  const me = call.participants.find((p) => p.user_id === userId)
  return !call.ended_at && !!me?.rung_at && !me.joined_at && !me.declined_at
}

/** Whether `call` is ringing for this user right now: unanswered and within the 30 s. */
export function ringsFor(call: Call, userId: string): boolean {
  const rungAt = call.participants.find((p) => p.user_id === userId)?.rung_at
  return unanswered(call, userId) && !!rungAt && Date.now() - new Date(rungAt).getTime() < RING_MS
}

const doNotDisturb = (): boolean => useAppearance.getState().settings.status === 'dnd'

/** A conversation's name: the group's, else its other members' names. */
export function dmTitle(dm: Dm, meId: string | null): string {
  if (dm.name) return dm.name
  const others = dm.members.filter((m) => m.user.id !== meId).map((m) => m.user.display_name)
  return others.length ? others.join(', ') : 'Só você'
}

/** The other person of a 1:1 DM. */
export function dmPeer(dm: Dm, meId: string | null): User | undefined {
  return dm.type === 'dm' ? dm.members.find((m) => m.user.id !== meId)?.user : undefined
}

export const useSocial = create<SocialState>()((set, get) => {
  const upsertDm = (dm: Dm): void => {
    set((s) => ({
      dms: { ...s.dms, [dm.id]: dm },
      presence: { ...s.presence, ...Object.fromEntries(dm.members.map((m) => [m.user.id, m.status])) }
    }))
    useChat.getState().mergeReads([dm.read])
  }

  const patchDm = (id: string, fn: (dm: Dm) => Dm): void =>
    set((s) => (s.dms[id] ? { dms: { ...s.dms, [id]: fn(s.dms[id]) } } : {}))

  const dropDm = (id: string): void => {
    set((s) => {
      const dms = { ...s.dms }
      delete dms[id]
      return { dms }
    })
    const voice = useVoice.getState()
    if (voice.channelId === id && !voice.serverId) void voice.leave()
    const nav = useNav.getState()
    if (nav.homePage === id) useNav.setState({ homePage: 'friends' })
  }

  const setCall = (call: Call): void => {
    patchDm(call.channel_id, (dm) => ({
      ...dm,
      call: call.ended_at ? null : call,
      voice_states: call.ended_at ? [] : dm.voice_states
    }))
    const { ringing, meId } = get()
    if (ringing?.call.id === call.id) {
      set({ ringing: meId && unanswered(call, meId) ? { ...ringing, call } : null })
      if (call.ended_at) playSound('call-ended') // hung up before we answered
    }
    if (call.ended_at) get().loadMissed()
  }

  /** In the call already (another device answered, or we started it): no ringing. */
  const inCall = (channelId: string): boolean => {
    const voice = useVoice.getState()
    return voice.phase !== 'idle' && voice.channelId === channelId
  }

  return {
    ...initial,

    reset: (meId) => set({ ...initial, meId }),

    load: async () => {
      const [friends, dms] = await Promise.all([api<Friend[]>('/friends'), api<Dm[]>('/dms')])
      const meId = get().meId
      const presence: Record<string, Presence> = {}
      for (const dm of dms) for (const m of dm.members) presence[m.user.id] = m.status
      for (const f of friends) if (f.kind === 'friend') presence[f.user.id] = f.status
      set({
        loaded: true,
        friends: Object.fromEntries(friends.map((f) => [f.user.id, f])),
        dms: Object.fromEntries(dms.map((d) => [d.id, d])),
        presence
      })
      useChat.getState().mergeReads(dms.map((d) => d.read))
      // Reconnected mid-ring: keep ringing for what's left of the 30 s.
      const call = dms.map((d) => d.call).find((c) => c && meId && ringsFor(c, meId) && !inCall(c.channel_id))
      const rungAt = call?.participants.find((p) => p.user_id === meId)?.rung_at
      if (call && rungAt && !doNotDisturb()) set({ ringing: { call, since: new Date(rungAt).getTime() } })
      get().loadMissed()
    },

    loadMissed: () => {
      api<Call[]>('/calls/missed').then((missed) => set({ missed }), () => {})
    },

    sendRequest: async (username) => {
      const friend = await api<Friend>('/friends/requests', { method: 'POST', body: { username } })
      set((s) => ({ friends: { ...s.friends, [friend.user.id]: friend } }))
      return friend
    },

    accept: async (userId) => {
      const friend = await api<Friend>(`/friends/${userId}/accept`, { method: 'POST' })
      set((s) => ({ friends: { ...s.friends, [userId]: friend } }))
    },

    remove: async (userId) => {
      await api(`/friends/${userId}`, { method: 'DELETE' })
      set((s) => {
        const friends = { ...s.friends }
        delete friends[userId]
        return { friends }
      })
    },

    block: async (userId) => {
      const friend = await api<Friend>(`/friends/${userId}/block`, { method: 'POST' })
      set((s) => ({ friends: { ...s.friends, [userId]: friend } }))
    },

    unblock: async (userId) => {
      await api(`/friends/${userId}/block`, { method: 'DELETE' })
      set((s) => {
        const friends = { ...s.friends }
        delete friends[userId]
        return { friends }
      })
    },

    openDm: async (userId) => {
      const existing = Object.values(get().dms).find((d) => d.type === 'dm' && d.members.some((m) => m.user.id === userId))
      const dm = existing ?? (await api<Dm>('/dms', { method: 'POST', body: { user_id: userId } }))
      upsertDm(dm)
      useNav.getState().openHome(dm.id)
      return dm.id
    },

    createGroup: async (userIds, name) => {
      const dm = await api<Dm>('/dms/groups', { method: 'POST', body: { user_ids: userIds, name: name || null } })
      upsertDm(dm)
      return dm
    },

    renameGroup: async (id, name) => {
      upsertDm(await api<Dm>(`/dms/${id}`, { method: 'PATCH', body: { name } }))
    },

    addMembers: async (id, userIds) => {
      upsertDm(await api<Dm>(`/dms/${id}/members`, { method: 'POST', body: { user_ids: userIds } }))
    },

    closeDm: async (id) => {
      await api(`/dms/${id}`, { method: 'DELETE' })
      dropDm(id)
    },

    startCall: async (channelId) => {
      const call = await api<Call>(`/channels/${channelId}/call`, { method: 'POST' })
      setCall(call)
      await useVoice.getState().join(null, channelId)
    },

    ringMore: async (callId, userIds) => {
      await api<Call>(`/calls/${callId}/ring`, { method: 'POST', body: { user_ids: userIds } })
    },

    answer: () => {
      const ringing = get().ringing
      if (!ringing) return
      set({ ringing: null })
      useNav.getState().openHome(ringing.call.channel_id)
      void useVoice.getState().join(null, ringing.call.channel_id)
    },

    decline: () => {
      const ringing = get().ringing
      if (!ringing) return
      set({ ringing: null })
      api(`/calls/${ringing.call.id}/decline`, { method: 'POST' }).catch(() => {})
    },

    dismissRing: () => {
      set({ ringing: null })
      get().loadMissed()
    },

    dismissMissedNotice: () => set({ missedNotice: null }),

    applyEvent: ({ type, data }) => {
      const { meId } = get()
      switch (type) {
        case 'ready':
          void get().load().catch(() => {})
          break

        case 'friend.updated':
          set((s) => ({
            friends: { ...s.friends, [data.user.id]: data },
            presence: data.kind === 'friend' ? { ...s.presence, [data.user.id]: data.status } : s.presence
          }))
          break
        case 'friend.removed':
          set((s) => {
            const friends = { ...s.friends }
            delete friends[data.user_id]
            return { friends }
          })
          break

        case 'dm.created':
        case 'dm.updated':
          upsertDm(data)
          break
        case 'dm.deleted':
          dropDm(data.id)
          break

        case 'message.created':
          if (data.server_id === null) {
            patchDm(data.channel_id, (dm) => ({ ...dm, last_message_id: Math.max(dm.last_message_id, data.id) }))
          }
          break
        case 'read.updated':
          if (data.server_id === null) get().loadMissed() // reading a conversation clears its missed calls
          break

        case 'call.ringing':
          setCall(data)
          if (!meId || !ringsFor(data, meId) || inCall(data.channel_id)) break
          if (doNotDisturb()) {
            set({ missedNotice: data })
            // It joins the missed calls (and the notifications) once the ring times out.
            setTimeout(() => get().loadMissed(), RING_MS + 1000)
          } else {
            set({ ringing: { call: data, since: Date.now() } })
          }
          break
        case 'call.updated':
          setCall(data)
          break
        case 'call.moved': {
          // Someone added a person to our 1:1 call: it continues in a new group.
          const from = Object.values(get().dms).find((d) => d.call?.id === data.from_call_id)
          setCall(data.call)
          const voice = useVoice.getState()
          if (from && voice.phase !== 'idle' && voice.channelId === from.id) {
            if (useNav.getState().homePage === from.id) useNav.getState().openHome(data.call.channel_id)
            void voice.join(null, data.call.channel_id)
          }
          break
        }

        case 'voice.state':
          if (data.dm_id) {
            patchDm(data.dm_id, (dm) => ({
              ...dm,
              voice_states: [...dm.voice_states.filter((v) => v.user_id !== data.user_id), ...(data.state ? [data.state] : [])]
            }))
          }
          break

        case 'presence.updated':
          set((s) => {
            const friend = s.friends[data.user_id]
            return {
              presence: { ...s.presence, [data.user_id]: data.status },
              friends: friend?.kind === 'friend' ? { ...s.friends, [data.user_id]: { ...friend, status: data.status } } : s.friends
            }
          })
          break

        case 'user.updated': {
          const swap = (u: User): User => (u.id === data.id ? { ...u, ...data } : u)
          set((s) => ({
            friends: s.friends[data.id] ? { ...s.friends, [data.id]: { ...s.friends[data.id], user: swap(s.friends[data.id].user) } } : s.friends,
            dms: Object.fromEntries(
              Object.entries(s.dms).map(([id, dm]) => [id, { ...dm, members: dm.members.map((m) => ({ ...m, user: swap(m.user) })) }])
            )
          }))
          break
        }
      }
    }
  }
})
