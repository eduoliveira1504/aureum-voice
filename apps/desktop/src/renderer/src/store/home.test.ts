import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { Call, Dm, Friend, HomeData, Message, ServerDetail, User } from '../lib/api'
import { useChat } from './chat'
import { friendsInCall, pendingItems, useHome } from './home'

const user = (id: string): User => ({ id, username: id, display_name: id } as User)
const ME = user('me')
const ANA = user('ana')
const BIA = user('bia')

const msg = (id: number, channelId: string, author: User, at: string, extra: Partial<Message> = {}): Message => ({
  id,
  channel_id: channelId,
  author,
  content: `msg ${id}`,
  attachments: [],
  created_at: at,
  edited_at: null,
  call: null,
  ...extra
})
const server = { id: 's1', name: 'Squad', channels: [{ id: 'c1' }], voice_states: [] } as unknown as ServerDetail
const dm = (id: string, extra: Partial<Dm> = {}): Dm => ({ id, type: 'dm', members: [], voice_states: [], ...extra }) as unknown as Dm
const friend = (u: User, kind: Friend['kind'], since = '2026-10-21T08:00:00Z'): Friend => ({ user: u, kind, since, status: 'online' })
const read = (unread: number, mentions = 0): { unread_count: number; mention_count: number } => ({ unread_count: unread, mention_count: mentions })

describe('pendingItems', () => {
  const base = {
    mentions: [{ serverId: 's1', message: msg(10, 'c1', ANA, '2026-10-21T12:00:00Z') }],
    dmPreviews: {
      d1: msg(20, 'd1', BIA, '2026-10-21T13:00:00Z'),
      d2: msg(21, 'd2', ANA, '2026-10-21T09:00:00Z'),
      d3: msg(22, 'd3', ANA, '2026-10-21T10:00:00Z', { call: { id: 'call1' } as Call })
    },
    servers: { s1: server },
    reads: { c1: read(3, 1), d1: read(2), d2: read(1), d3: read(1) },
    dms: { d1: dm('d1'), d2: dm('d2'), d3: dm('d3') },
    friends: { bia: friend(BIA, 'incoming', '2026-10-21T11:00:00Z'), ana: friend(ANA, 'friend') },
    missed: [{ id: 'call1', channel_id: 'd3', started_at: '2026-10-21T10:00:00Z' } as Call],
    muted: ['d2']
  }

  it('lists mentions, unread DMs, missed calls and requests, newest first', () => {
    expect(pendingItems(base).map((i) => i.key)).toEqual(['d:d1', 'm:10', 'f:bia', 'c:call1'])
    // A silenced DM, and a DM whose newest message is the call line (shown as the missed call), stay out.
  })

  it('follows the read counters', () => {
    const reads = { ...base.reads, c1: read(0, 0), d1: read(0) }
    expect(pendingItems({ ...base, reads }).map((i) => i.key)).toEqual(['f:bia', 'c:call1'])
  })

  it('drops mentions of channels no longer visible', () => {
    const servers = { s1: { ...server, channels: [] } }
    expect(pendingItems({ ...base, servers }).map((i) => i.kind)).not.toContain('mention')
  })
})

describe('friendsInCall', () => {
  it('counts friends in a room of a shared server or in a call with me, once each', () => {
    const s = { ...server, voice_states: [{ user_id: 'ana' }, { user_id: 'stranger' }] } as unknown as ServerDetail
    const dms = { d1: dm('d1', { voice_states: [{ user_id: 'ana' }, { user_id: 'bia' }] as Dm['voice_states'] }) }
    const friends = { ana: friend(ANA, 'friend'), bia: friend(BIA, 'friend') }
    expect([...friendsInCall(friends, { s1: s }, dms)].sort()).toEqual(['ana', 'bia'])
  })
})

describe('home store', () => {
  const data: HomeData = {
    mentions: [{ server_id: 's1', message: msg(10, 'c1', ANA, '2026-10-21T12:00:00Z') }],
    dms: [{ channel_id: 'd1', unread_count: 1, message: msg(20, 'd1', BIA, '2026-10-21T13:00:00Z') }],
    tasks: [],
    tasks_total: 0,
    servers: [{ id: 's1', last_activity_at: null }]
  }

  beforeEach(async () => {
    useChat.setState({ meId: ME.id })
    vi.spyOn(api, 'api').mockResolvedValue(data)
    useHome.getState().open()
    await vi.waitFor(() => expect(useHome.getState().loaded).toBe(true))
    return () => useHome.getState().close()
  })

  it('adds new mentions and DM messages as they arrive, and server activity', () => {
    const mention = msg(30, 'c1', ANA, '2026-10-21T14:00:00Z')
    useHome.getState().applyEvent({ type: 'message.created', data: { ...mention, server_id: 's1', mentions: [ME.id] } })
    const fromBia = msg(31, 'd1', BIA, '2026-10-21T14:01:00Z')
    useHome.getState().applyEvent({ type: 'message.created', data: { ...fromBia, server_id: null, mentions: [] } })
    const mine = msg(32, 'd1', ME, '2026-10-21T14:02:00Z')
    useHome.getState().applyEvent({ type: 'message.created', data: { ...mine, server_id: null, mentions: [] } })
    const s = useHome.getState()
    expect(s.mentions.map((m) => m.message.id)).toEqual([30, 10])
    expect(s.dmPreviews.d1.id).toBe(31)
    expect(s.activity.s1).toBe('2026-10-21T14:00:00Z')
  })

  it('drops what was read, here or on another device', () => {
    useHome.getState().applyEvent({ type: 'read.updated', data: { channel_id: 'c1', last_read_message_id: 10, server_id: 's1' } })
    useHome.getState().applyEvent({ type: 'read.updated', data: { channel_id: 'd1', last_read_message_id: 19, server_id: null } })
    expect(useHome.getState().mentions).toEqual([])
    expect(useHome.getState().dmPreviews.d1.id).toBe(20) // read only up to an older message
  })

  it('refetches tasks once after a burst of addon changes', async () => {
    vi.useFakeTimers()
    const call = vi.spyOn(api, 'api').mockResolvedValue([])
    for (let i = 0; i < 5; i++) useHome.getState().applyEvent({ type: 'addon.kanban.cards.moved', data: {} })
    await vi.advanceTimersByTimeAsync(1100)
    expect(call.mock.calls.filter(([path]) => path === '/users/me/tasks')).toHaveLength(1)
    vi.useRealTimers()
  })
})
