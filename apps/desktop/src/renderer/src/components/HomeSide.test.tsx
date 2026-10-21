/**
 * Block 3.4, the hub's side column: Amigos ativos, Seus servidores and Novidades do Aureum.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { Activity, Channel, Friend, HomeData, Me, Presence, ServerDetail, User, VoiceState } from '../lib/api'
import { CHANGELOG, parseChangelog, releaseNotes } from '../lib/changelog'
import { Perm } from '../lib/permissions'
import { useActivity } from '../store/activity'
import { DEFAULT_SETTINGS, useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { useNav } from '../store/nav'
import { useSocial } from '../store/social'
import { activeFriends, HomeHub, serverSummaries } from './HomeHub'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))

const person = (id: string): User => ({ id, username: id, display_name: id[0].toUpperCase() + id.slice(1), avatar_url: null, badges: [] }) as unknown as User
const ME = { ...person('edu'), email: 'edu@example.com' } as unknown as Me
const friend = (u: User, status: Presence = 'online'): Friend => ({ user: u, kind: 'friend', since: '2026-01-01T00:00:00Z', status })
const room = (id: string, name: string, overrides: Channel['overrides'] = []): Channel =>
  ({ id, server_id: 's-1', name, type: 'voice', overrides }) as unknown as Channel
const state = (userId: string, channelId: string, screen = false): VoiceState =>
  ({ user_id: userId, channel_id: channelId, muted: false, deafened: false, camera: false, screen }) as VoiceState
const server = (id: string, name: string, channels: Channel[], voice: VoiceState[] = []): ServerDetail =>
  ({
    id,
    name,
    icon_url: null,
    owner_id: 'x',
    roles: [{ id, permissions: Perm.VIEW_CHANNEL | Perm.CONNECT }],
    channels,
    members: [],
    voice_states: voice
  }) as unknown as ServerDetail
const playing = (name: string): Activity => ({ type: 'playing', name, started_at: '2026-10-21T14:00:00Z' })

const ANA = person('ana')
const BIA = person('bia')
const CAIO = person('caio')
const DANI = person('dani')
const OFF = person('off')

beforeEach(() => {
  const home: HomeData = { mentions: [], dms: [], tasks: [], tasks_total: 0, servers: [] }
  vi.spyOn(api, 'api').mockImplementation(async (path) => (path === '/users/me/home' ? home : []))
  useChat.setState({ meId: ME.id, loaded: true, servers: {}, order: [], reads: {}, messages: {} })
  useSocial.setState({ meId: ME.id, loaded: true, friends: {}, dms: {}, presence: {}, missed: [] })
  useActivity.setState({ byUser: {} })
  useAppearance.setState({ settings: { ...DEFAULT_SETTINGS } })
  useNav.setState({ place: 'home', homePage: 'hub' })
})

describe('Amigos ativos', () => {
  it('puts friends in a call first, then playing, then the rest; offline stays out', () => {
    const noConnect = room('v-2', 'Fechada', [{ target_type: 'member', target_id: ME.id, allow: 0, deny: Perm.CONNECT }])
    const squad = server('s-1', 'Squad', [room('v-1', 'Sala geral'), noConnect], [state(DANI.id, 'v-1'), state(CAIO.id, 'v-2')])
    const friends = Object.fromEntries([ANA, BIA, CAIO, DANI, OFF].map((u) => [u.id, friend(u)]))
    const presence: Record<string, Presence> = { ana: 'online', bia: 'idle', caio: 'dnd', dani: 'online', off: 'offline' }
    const list = activeFriends(friends, presence, { bia: playing('League of Legends') }, { 's-1': squad }, {}, ME.id)
    expect(list.map((f) => f.friend.user.id)).toEqual(['caio', 'dani', 'bia', 'ana'])
    expect(list[0].call?.label).toBe('Em call · Fechada')
    expect(list[0].call?.join).toBeUndefined() // sees the room, can't connect
    expect(list[1].call?.join).toBeTypeOf('function')
  })

  it('offers Entrar, Ligar or Mensagem, and Ver todos opens Amigos', async () => {
    const people = [ANA, BIA, DANI, person('eva'), person('fabi'), person('gil'), person('hugo')]
    useSocial.setState({ friends: Object.fromEntries(people.map((u) => [u.id, friend(u)])) })
    useActivity.setState({ byUser: { bia: playing('Valorant') } })
    useChat.setState({ servers: { 's-1': server('s-1', 'Squad', [room('v-1', 'Sala geral')], [state(DANI.id, 'v-1')]) }, order: ['s-1'] })
    render(<HomeHub me={ME} />)
    const card = screen.getByRole('region', { name: 'Amigos ativos' })
    expect(within(card).getByText('7 online')).toBeTruthy()
    const rows = within(card).getAllByRole('listitem')
    expect(rows).toHaveLength(6)
    expect(within(rows[0]).getByRole('button', { name: 'Entrar' })).toBeTruthy()
    expect(within(rows[1]).getByRole('button', { name: 'Ligar para Bia' })).toBeTruthy()
    expect(within(rows[2]).getByRole('button', { name: 'Mensagem para Ana' })).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Ver todos' }))
    expect(useNav.getState().homePage).toBe('friends')
  })
})

describe('Seus servidores', () => {
  it('orders by people in a call, then the newest message, with mentions', () => {
    const quiet = server('s-q', 'Quieto', [])
    const chatty = server('s-c', 'Papo', [{ id: 't-1', type: 'text' } as Channel])
    const live = server('s-l', 'Ao vivo', [room('v-1', 'Sala')], [state('a', 'v-1', true), state('b', 'v-1')])
    const list = serverSummaries(
      ['s-q', 's-c', 's-l'],
      { 's-q': quiet, 's-c': chatty, 's-l': live },
      { 't-1': { mention_count: 2 } },
      { 's-c': '2026-10-21T12:00:00Z', 's-q': null }
    )
    expect(list.map((s) => s.server.id)).toEqual(['s-l', 's-c', 's-q'])
    expect([list[0].inCall, list[0].streaming, list[1].mentions]).toEqual([2, 1, 2])
  })

  it('is a grid beside Ao vivo agora, out of the side column', async () => {
    const live = server('s-l', 'Ao vivo', [room('v-1', 'Sala'), { id: 't-1', type: 'text' } as Channel], [state('a', 'v-1', true), state('b', 'v-1')])
    useChat.setState({ servers: { 's-l': live }, order: ['s-l'], reads: { 't-1': { channel_id: 't-1', last_read_message_id: 0, unread_count: 1, mention_count: 3 } } })
    render(<HomeHub me={ME} />)
    const grid = screen.getByRole('region', { name: 'Seus servidores' })
    const side = screen.getByRole('complementary', { name: 'Coluna lateral' })
    expect(side.contains(grid)).toBe(false)
    expect(within(side).queryByRole('region', { name: 'Seus servidores' })).toBeNull()
    // Same row as the live rooms: their nearest shared container is that row.
    const liveRooms = screen.getByRole('region', { name: 'Ao vivo agora' })
    const row = grid.parentElement?.parentElement
    expect(row?.contains(liveRooms)).toBe(true)
    expect(row?.contains(side)).toBe(false)

    const tile = within(grid).getByRole('button', { name: /Ao vivo/ })
    expect(within(tile).getByLabelText('1 transmitindo')).toBeTruthy()
    expect(tile.textContent).toContain('2 em call')
    expect(tile.textContent).toContain('3')
  })

  it('opens a server bringing its closed tab back, and + creates or joins one', async () => {
    const update = vi.fn()
    useAppearance.setState({ settings: { ...DEFAULT_SETTINGS, closed_tabs: ['s-1'], tab_order: ['s-1'] }, update } as never)
    useChat.setState({ servers: { 's-1': server('s-1', 'Squad', []) }, order: ['s-1'] })
    render(<HomeHub me={ME} />)
    const grid = screen.getByRole('region', { name: 'Seus servidores' })
    fireEvent.click(within(grid).getByRole('button', { name: /Squad/ }))
    expect(useNav.getState().place).toBe('s-1')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ closed_tabs: [] }))

    fireEvent.click(within(grid).getByRole('button', { name: 'Criar ou entrar em um servidor' }))
    expect(await screen.findByRole('dialog', { name: 'Criar um servidor' })).toBeTruthy()
  })

  it('shows up to 6, and Ver todos lists them all', async () => {
    const many = Array.from({ length: 12 }, (_, i) => server(`s-${i}`, `Servidor ${i}`, []))
    useChat.setState({ servers: Object.fromEntries(many.map((s) => [s.id, s])), order: many.map((s) => s.id) })
    render(<HomeHub me={ME} />)
    const grid = screen.getByRole('region', { name: 'Seus servidores' })
    const tiles = (): HTMLElement[] => within(grid).getAllByRole('button', { name: /Servidor [0-9]+/ })
    expect(tiles()).toHaveLength(6)
    fireEvent.click(within(grid).getByRole('button', { name: 'Ver todos (12)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Seus servidores' })
    expect(within(dialog).getAllByRole('button', { name: /Servidor [0-9]+/ })).toHaveLength(12)
    fireEvent.click(within(dialog).getByRole('button', { name: /Servidor 11/ }))
    expect(useNav.getState().place).toBe('s-11')
    expect(screen.queryByRole('dialog', { name: 'Seus servidores' })).toBeNull()
  })
})

describe('Novidades do Aureum', () => {
  it('parses the changelog, joining wrapped lines', () => {
    const sections = parseChangelog('# Novidades\n\n## Próxima versão\n\n- Logo\n\n## 1.0\n\n- **Novo:** algo que\n  quebra a linha\n- Outro\n')
    expect(sections).toEqual([
      { title: 'Próxima versão', items: ['Logo'] },
      { title: '1.0', items: ['**Novo:** algo que quebra a linha', 'Outro'] }
    ])
    expect(releaseNotes(sections, '1.0')?.title).toBe('1.0')
    expect(releaseNotes(sections, '9.9')?.title).toBe('1.0') // not listed (dev build): newest released
    expect(CHANGELOG.length).toBeGreaterThan(0) // the real file is built in
  })

  it('shows the installed version, opens everything, and can be dismissed until the next one', async () => {
    const update = vi.fn()
    useAppearance.setState({ update } as never)
    // The test bridge reports 0.0.0-test, which isn't listed: the newest released notes show.
    const expected = releaseNotes(CHANGELOG, '0.0.0-test')
    render(<HomeHub me={ME} />)
    const card = await screen.findByRole('region', { name: 'Novidades do Aureum' })
    expect(within(card).getByText(expected?.title ?? '')).toBeTruthy()
    expect(within(card).getAllByRole('listitem').length).toBeLessThanOrEqual(3)
    fireEvent.click(within(card).getByRole('button', { name: 'Ver tudo que mudou' }))
    expect(await screen.findByRole('dialog', { name: 'Novidades do Aureum' })).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Dispensar' }))
    expect(update).toHaveBeenCalledWith({ news_dismissed: '0.0.0-test' })
  })

  it('stays hidden once dismissed for this version', async () => {
    useAppearance.setState({ settings: { ...DEFAULT_SETTINGS, news_dismissed: '0.0.0-test' } })
    render(<HomeHub me={ME} />)
    await screen.findByRole('region', { name: 'Seus servidores' })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Novidades do Aureum' })).toBeNull())
  })
})
