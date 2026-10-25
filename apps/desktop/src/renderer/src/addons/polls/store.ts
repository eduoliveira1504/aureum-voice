import { create } from 'zustand'

import { api } from '../../lib/api'

export type Duration = '1h' | '8h' | '24h' | '3d' | '1w'

export const DURATIONS: { value: Duration | ''; label: string }[] = [
  { value: '', label: 'Sem prazo' },
  { value: '1h', label: '1 hora' },
  { value: '8h', label: '8 horas' },
  { value: '24h', label: '24 horas' },
  { value: '3d', label: '3 dias' },
  { value: '1w', label: '1 semana' }
]

export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 10

export interface PollOption {
  id: string
  text: string
  emoji: string | null
  votes: number
  /** Who picked it; null in an anonymous poll (for everyone). */
  voter_ids: string[] | null
}

export interface Poll {
  id: string
  channel_id: string
  message_id: number
  question: string
  options: PollOption[]
  multiple: boolean
  anonymous: boolean
  closes_at: string | null
  closed_at: string | null
  closed: boolean
  total_voters: number
  created_by: string | null
  /** The signed-in user's picks. */
  my_votes: string[]
}

export interface PollDraft {
  question: string
  options: { text: string; emoji?: string | null }[]
  multiple: boolean
  anonymous: boolean
  duration: Duration | null
}

export const pollsPath = (channelId: string, path = ''): string => `/addons/polls/channels/${channelId}/polls${path}`

/** Whether the poll is closed now: by hand, or because its deadline passed (the API's line may
 * come a little later). */
export const isClosed = (poll: Poll, now = Date.now()): boolean =>
  poll.closed || (!!poll.closes_at && new Date(poll.closes_at).getTime() <= now)

/** Percent of the people who voted that picked this option (whole number). */
export const percent = (poll: Poll, option: PollOption): number =>
  poll.total_voters ? Math.round((option.votes / poll.total_voters) * 100) : 0

/** The options with the most votes, once anyone voted. */
export function leaders(poll: Poll): Set<string> {
  const top = Math.max(0, ...poll.options.map((o) => o.votes))
  return new Set(top ? poll.options.filter((o) => o.votes === top).map((o) => o.id) : [])
}

/** What a click on an option makes the vote: in a single-choice poll it picks that one (or takes
 * the vote back when it was the pick); in a multiple-choice one it toggles it. */
export function nextVotes(poll: Poll, optionId: string): string[] {
  const mine = poll.my_votes
  if (!poll.multiple) return mine.length === 1 && mine[0] === optionId ? [] : [optionId]
  return mine.includes(optionId) ? mine.filter((id) => id !== optionId) : [...mine, optionId]
}

// Polls asked for in the same tick go in one request per chat.
const pending = new Map<string, Set<string>>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

interface PollsState {
  /** By poll id. */
  polls: Record<string, Poll>
  /** Ids already asked for (so a poll that's gone isn't asked for again and again). */
  requested: Record<string, true>
  /** Fetches the poll if it isn't here yet (batched per chat). */
  want(channelId: string, pollId: string): void
  load(channelId: string, ids: string[]): Promise<void>
  create(channelId: string, draft: PollDraft): Promise<Poll>
  vote(poll: Poll, optionIds: string[]): Promise<void>
  close(poll: Poll): Promise<void>
  /** Applies an `addon.polls.*` event. */
  apply(type: string, data: Record<string, unknown>): void
}

export const usePolls = create<PollsState>()((set, get) => ({
  polls: {},
  requested: {},

  want: (channelId, pollId) => {
    if (get().requested[pollId]) return
    set((s) => ({ requested: { ...s.requested, [pollId]: true } }))
    const ids = pending.get(channelId) ?? new Set<string>()
    ids.add(pollId)
    pending.set(channelId, ids)
    flushTimer ??= setTimeout(() => {
      flushTimer = null
      const batches = [...pending]
      pending.clear()
      for (const [channel, wanted] of batches) {
        const ids = [...wanted]
        // Failed: the next time the poll shows up, it's asked for again.
        get().load(channel, ids).catch(() =>
          set((s) => ({ requested: Object.fromEntries(Object.entries(s.requested).filter(([id]) => !ids.includes(id))) }))
        )
      }
    }, 0)
  },

  load: async (channelId, ids) => {
    if (!ids.length) return
    const query = ids.map((id) => `ids=${encodeURIComponent(id)}`).join('&')
    const list = await api<Poll[]>(pollsPath(channelId, `?${query}`))
    set((s) => ({ polls: { ...s.polls, ...Object.fromEntries(list.map((p) => [p.id, p])) } }))
  },

  create: async (channelId, draft) => {
    const poll = await api<Poll>(pollsPath(channelId), { method: 'POST', body: draft })
    set((s) => ({ polls: { ...s.polls, [poll.id]: poll }, requested: { ...s.requested, [poll.id]: true } }))
    return poll
  },

  vote: async (poll, optionIds) => {
    const updated = await api<Poll>(pollsPath(poll.channel_id, `/${poll.id}/vote`), { method: 'PUT', body: { option_ids: optionIds } })
    set((s) => ({ polls: { ...s.polls, [updated.id]: updated } }))
  },

  close: async (poll) => {
    const updated = await api<Poll>(pollsPath(poll.channel_id, `/${poll.id}/close`), { method: 'POST' })
    set((s) => ({ polls: { ...s.polls, [updated.id]: updated } }))
  },

  apply: (type, data) => {
    const id = data.id as string
    const known = get().polls[id]
    if (type === 'addon.polls.updated') {
      // Counts for everyone; the user's own picks stay as they were.
      const poll = data as unknown as Omit<Poll, 'my_votes'>
      if (known || get().requested[id]) set((s) => ({ polls: { ...s.polls, [id]: { ...poll, my_votes: known?.my_votes ?? [] } } }))
    } else if (type === 'addon.polls.voted' && known) {
      set((s) => ({ polls: { ...s.polls, [id]: { ...known, my_votes: data.my_votes as string[] } } }))
    }
  }
}))

/** Reconnected: what's on screen may have changed meanwhile. */
export function reloadPolls(): void {
  const byChannel = new Map<string, string[]>()
  for (const poll of Object.values(usePolls.getState().polls)) byChannel.set(poll.channel_id, [...(byChannel.get(poll.channel_id) ?? []), poll.id])
  for (const [channel, ids] of byChannel) {
    for (let i = 0; i < ids.length; i += 50) void usePolls.getState().load(channel, ids.slice(i, i + 50)).catch(() => {})
  }
}
