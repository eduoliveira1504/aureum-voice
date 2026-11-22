/** Block 4.2.10: sharing a result as a challenge, and the challenge card in a conversation. */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChallengeCard } from '../../addons/daily/ChallengeCard'
import * as api from '../../lib/api'
import type { Channel, Friend, Me, Message, ServerDetail, User } from '../../lib/api'
import { Perm } from '../../lib/permissions'
import { useChat } from '../../store/chat'
import { useDaily } from '../../store/daily'
import { useSocial } from '../../store/social'
import { ShareChallengeModal } from './ShareChallenge'

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))
const ME = { id: 'me', username: 'me', display_name: 'Eu', avatar_url: null, badges: [], email: 'me@example.com' } as unknown as Me
const DAY = '2026-11-22'
const user = (id: string, name: string): User => ({ id, username: id, display_name: name, avatar_url: null, badges: [] }) as unknown as User
const friend = (u: User): Friend => ({ user: u, kind: 'friend', since: '2026-01-01T00:00:00Z', status: 'online' }) as Friend
const channel = (id: string, overrides: Channel['overrides'] = []): Channel =>
  ({ id, server_id: 's-1', name: id, type: 'text', position: 0, category_id: null, permissions_synced: true, addon_key: null, config: {}, overrides }) as Channel
const SERVER = {
  id: 's-1',
  name: 'Squad',
  owner_id: 'someone',
  roles: [{ id: 's-1', permissions: Perm.VIEW_CHANNEL | Perm.SEND_MESSAGES, position: 0 }],
  channels: [channel('geral'), channel('avisos', [{ target_type: 'role', target_id: 's-1', allow: 0, deny: Perm.SEND_MESSAGES }])],
  categories: [],
  members: [{ user: ME, role_ids: [] }],
  voice_states: []
} as unknown as ServerDetail

const read = (channel_id: string) => ({ channel_id, last_read_message_id: 0, unread_count: 0, mention_count: 0 })

let calls: { path: string; body?: unknown }[] = []
beforeEach(() => {
  calls = []
  vi.spyOn(api, 'api').mockImplementation(async (path, options) => {
    calls.push({ path, body: options?.body })
    if (path === '/dms') {
      const id = (options?.body as { user_id: string }).user_id
      return { id: `dm-${id}`, type: 'dm', name: null, members: [{ user: ME }, { user: user(id, id) }], voice_states: [], read: read(`dm-${id}`) }
    }
    if (path.endsWith('/share')) return { shared: (options?.body as { channel_ids: string[] }).channel_ids, already: [] }
    if (path.includes('/ranking')) return [{ user_id: 'ana', time_ms: 130_000, attempts: 1 }]
    if (path === '/daily') return { day: DAY, games: ['sudoku'], results: [], streak: 0, friends_today: [] }
    return []
  })
  useChat.setState({ meId: 'me', servers: { 's-1': SERVER }, order: ['s-1'] })
  const dm = (id: string, name: string) => ({ id: `dm-${id}`, type: 'dm', members: [{ user: ME }, { user: user(id, name) }], voice_states: [], read: read(`dm-${id}`) })
  useSocial.setState({
    friends: { ana: friend(user('ana', 'Ana')), bia: friend(user('bia', 'Bia')) },
    // Ana already has a DM; Bia's is created.
    dms: { 'dm-ana': dm('ana', 'Ana') } as never
  })
  useDaily.setState({ summary: { day: DAY, games: ['sudoku'], results: [], streak: 0, friends_today: [] }, failed: false })
})

describe('sharing a challenge', () => {
  it('to friends: each gets it in the DM, without opening any', async () => {
    render(<ShareChallengeModal game="sudoku" gameLabel="Sudoku" day={DAY} target="friends" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Ana/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Enviar desafio' })))
    expect(calls.find((c) => c.path.endsWith('/share'))?.body).toEqual({ day: DAY, channel_ids: ['dm-ana', 'dm-bia'] })
    expect(screen.getByText('Desafio enviado para 2 conversas.')).toBeTruthy()
  })

  it('to a server: only text channels where I can write', async () => {
    render(<ShareChallengeModal game="sudoku" gameLabel="Sudoku" day={DAY} target="server" onClose={() => {}} />)
    const options = within(screen.getByLabelText('Canal')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['#geral'])
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Enviar desafio' })))
    expect(calls.find((c) => c.path.endsWith('/share'))?.body).toEqual({ day: DAY, channel_ids: ['geral'] })
  })
})

describe('the challenge card', () => {
  const message = (day = DAY): Message =>
    ({
      id: 9,
      channel_id: 'geral',
      author: user('ana', 'Ana'),
      content: 'Desafio do dia: Sudoku…',
      attachments: [],
      created_at: '2026-11-22T12:00:00Z',
      edited_at: null,
      embed: { addon_key: 'daily', id: `sudoku:${day}`, game: 'sudoku', day, time_ms: 130_000, attempts: 1 }
    }) as unknown as Message
  const props = (m: Message) => ({ message: m, channel: channel('geral'), me: ME, canModerate: false, userOf: (id: string) => user(id, id === 'ana' ? 'Ana' : id), nameOf: (id: string) => (id === 'ana' ? 'Ana' : id) })

  it("shows the sender's result, the ranking here and Jogar for today's", async () => {
    render(<ChallengeCard {...props(message())} />)
    expect(screen.getByText('Ana fez em 2:10. Consegue fazer melhor?')).toBeTruthy()
    expect(await screen.findByText('2:10', { selector: 'li span' })).toBeTruthy()
    expect(calls.some((c) => c.path === `/daily/sudoku/ranking?channel_id=geral&day=${DAY}`)).toBe(true)
    expect(screen.getByRole('button', { name: 'Jogar' })).toBeTruthy()
  })

  it('a past day is closed', async () => {
    render(<ChallengeCard {...props(message('2026-11-20'))} />)
    expect(await screen.findByText('Desafio encerrado')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Jogar' })).toBeNull()
  })
})
