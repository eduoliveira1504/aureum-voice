/**
 * Block 3.4: Home opens on the hub (Início), with Amigos next to it in the sidebar. The hub's live
 * rooms come from the chat and social stores; the rest from GET /users/me/home.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { Channel, Dm, Friend, HomeData, Me, Member, ServerDetail, User, VoiceState } from '../lib/api'
import { Perm } from '../lib/permissions'
import * as realtime from '../lib/realtime'
import { useChat } from '../store/chat'
import { liveRooms } from '../store/home'
import { useNav } from '../store/nav'
import { useSocial } from '../store/social'
import { useVoice } from '../store/voice'
import { greeting, HomeHub, hubSummary, liveFor } from './HomeHub'
import { Sidebar } from './Sidebar'
import { StartCallModal } from './socialModals'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))

function person(id: string, username: string, extra: Partial<User> = {}): User {
  return {
    id,
    username,
    display_name: username[0].toUpperCase() + username.slice(1),
    avatar_url: null,
    banner_url: null,
    bio: null,
    accent_color: null,
    pronouns: null,
    custom_status: null,
    avatar_frame: 'none',
    favorite_song: null,
    links: [],
    badges: [],
    created_at: '2026-01-01T00:00:00Z',
    ...extra
  }
}

const ME: Me = { ...person('u-me', 'edu'), email: 'edu@example.com', is_app_owner: false, email_verified: true, must_change_password: false }
const ANA = person('u-ana', 'ana')
const BIA = person('u-bia', 'bia')
const CAIO = person('u-caio', 'caio')
const DUDA = person('u-duda', 'duda')

const EMPTY_HOME: HomeData = { mentions: [], dms: [], tasks: [], tasks_total: 0, servers: [] }

const voiceRoom = (id: string, name: string, overrides: Channel['overrides'] = []): Channel => ({
  id,
  server_id: 's-1',
  name,
  type: 'voice',
  position: 0,
  addon_key: null,
  config: {},
  overrides
})
const member = (user: User): Member => ({
  user,
  role_ids: [],
  joined_at: '2026-01-01T00:00:00Z',
  nickname: null,
  voice_muted: false,
  voice_deafened: false,
  status: 'online',
  online: true
})
const inRoom = (user: User, channelId: string, extra: Partial<VoiceState> = {}): VoiceState => ({
  user_id: user.id,
  channel_id: channelId,
  muted: false,
  deafened: false,
  camera: false,
  screen: false,
  joined_at: new Date(Date.now() - 41 * 60_000).toISOString(),
  ...extra
})
function server(id: string, name: string, channels: Channel[], voice: VoiceState[]): ServerDetail {
  const everyone = { id, server_id: id, name: '@everyone', color: null, icon_url: null, position: 0, permissions: Perm.VIEW_CHANNEL | Perm.CONNECT, hoist: false, mentionable: false }
  return {
    id,
    name,
    icon_url: null,
    banner_url: null,
    owner_id: 'someone-else',
    created_at: '2026-01-01T00:00:00Z',
    roles: [everyone],
    channels,
    members: [ME, ANA, BIA, CAIO, DUDA].map(member),
    voice_states: voice,
    reads: []
  }
}

beforeEach(() => {
  vi.spyOn(api, 'api').mockImplementation(async (path) => (path === '/users/me/home' ? EMPTY_HOME : []))
  useChat.setState({ meId: ME.id, loaded: true, servers: {}, order: [], reads: {}, messages: {} })
  useSocial.setState({ meId: ME.id, loaded: true, friends: {}, dms: {}, presence: {}, missed: [] })
  useNav.setState({ place: 'home', homePage: 'hub' })
})

describe('greeting', () => {
  it('follows the local clock', () => {
    const at = (h: number): string => greeting(new Date(2026, 9, 21, h, 30))
    expect([at(4), at(5), at(11), at(12), at(17), at(18), at(23)]).toEqual([
      'Boa noite',
      'Bom dia',
      'Bom dia',
      'Boa tarde',
      'Boa tarde',
      'Boa noite',
      'Boa noite'
    ])
  })
})

describe('summary line', () => {
  it('counts friends in a call and things waiting, or says all is clear', () => {
    expect(hubSummary(2, 4)).toBe('2 amigos em call agora e 4 coisas esperando por você.')
    expect(hubSummary(1, 0)).toBe('1 amigo em call agora.')
    expect(hubSummary(0, 1)).toBe('1 coisa esperando por você.')
    expect(hubSummary(0, 0)).toBe('Tudo em dia por aqui.')
  })
})

describe('Iniciar chamada', () => {
  it('calls a friend through their DM, or a group', async () => {
    const group = { id: 'g-1', type: 'group_dm', name: 'Duo de sexta', icon_url: null, members: [], last_message_id: 1, voice_states: [] }
    useSocial.setState({
      friends: { [ANA.id]: { user: ANA, kind: 'friend', since: '2026-01-01T00:00:00Z', status: 'online' } },
      dms: { [group.id]: group as never }
    })
    const openDm = vi.fn(async () => 'd-ana')
    const startCall = vi.fn(async () => {})
    useSocial.setState({ openDm, startCall } as never)
    const onClose = vi.fn()
    const { unmount } = render(<StartCallModal meId={ME.id} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /Ana/ }))
    await waitFor(() => expect(startCall).toHaveBeenCalledWith('d-ana'))
    expect(openDm).toHaveBeenCalledWith(ANA.id)
    expect(useNav.getState().homePage).toBe('d-ana')
    expect(onClose).toHaveBeenCalled()
    unmount()

    render(<StartCallModal meId={ME.id} onClose={() => {}} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar amigos e grupos' }), { target: { value: 'sexta' } })
    expect(screen.queryByRole('button', { name: /Ana/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Duo de sexta/ }))
    await waitFor(() => expect(startCall).toHaveBeenCalledWith('g-1'))
  })
})

describe('Home sidebar', () => {
  it('starts on Início and counts pending requests on Amigos', () => {
    useSocial.setState({ friends: { [ANA.id]: { user: ANA, kind: 'incoming', since: '2026-10-21T10:00:00Z', status: 'offline' } } })
    render(<Sidebar server={null} me={ME} />)
    const inicio = screen.getByRole('button', { name: 'Início' })
    const amigos = screen.getByRole('button', { name: /^Amigos/ })
    expect(inicio.getAttribute('aria-current')).toBe('page')
    expect(amigos.textContent).toContain('1')
    fireEvent.click(amigos)
    expect(useNav.getState().homePage).toBe('friends')
    fireEvent.click(screen.getByRole('button', { name: 'Início' }))
    expect(useNav.getState().homePage).toBe('hub')
  })
})

describe('Ao vivo agora', () => {
  const friendsOf = (...users: User[]): Record<string, Friend> =>
    Object.fromEntries(users.map((u) => [u.id, { user: u, kind: 'friend' as const, since: '2026-01-01T00:00:00Z', status: 'online' as const }]))

  it('shows rooms I can join, friends first, and calls in my groups', () => {
    const noConnect = voiceRoom('v-ranked', 'Ranked', [{ target_type: 'member', target_id: ME.id, allow: 0, deny: Perm.CONNECT }])
    const busy = server('s-2', 'Galera', [voiceRoom('v-busy', 'Lotada')], [inRoom(BIA, 'v-busy'), inRoom(CAIO, 'v-busy'), inRoom(DUDA, 'v-busy')])
    const squad = server('s-1', 'Squad', [voiceRoom('v-geral', 'Sala geral'), noConnect, voiceRoom('v-empty', 'Vazia')], [
      inRoom(ANA, 'v-geral'),
      inRoom(BIA, 'v-ranked')
    ])
    const group = { id: 'g-1', type: 'group_dm', name: 'Duo de sexta', icon_url: null, members: [member(ME), member(CAIO)], last_message_id: 1, call: { id: 'c-1' }, voice_states: [inRoom(CAIO, 'g-1')] }
    const rooms = liveRooms({ 's-1': squad, 's-2': busy }, { 'g-1': group as unknown as Dm }, friendsOf(ANA), ME.id)
    // A room without CONNECT and an empty one stay out; a private room never even reaches the
    // app (the API leaves it out of the server's channels and voice states).
    expect(rooms.map((r) => r.key)).toEqual(['v-geral', 'v-busy', 'g-1'])
  })

  it('formats how long a room has been going', () => {
    const now = Date.parse('2026-10-21T15:00:00Z')
    const ago = (min: number): string => new Date(now - min * 60_000).toISOString()
    expect([liveFor(ago(0), now), liveFor(ago(41), now), liveFor(ago(60), now), liveFor(ago(65), now)]).toEqual([
      'agora',
      '41 min',
      '1 h',
      '1 h 5 min'
    ])
  })

  it('updates live when someone joins, and Entrar joins the room', async () => {
    const join = vi.fn(async () => {})
    useVoice.setState({ join } as never)
    useSocial.setState({ friends: friendsOf(ANA) })
    useChat.setState({ servers: { 's-1': server('s-1', 'Squad', [voiceRoom('v-geral', 'Sala geral')], []) } })
    render(<HomeHub me={ME} />)
    expect(await screen.findByText('Ninguém em call agora.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Chamar alguém/ })).toBeTruthy()

    act(() => useChat.getState().applyEvent({ type: 'voice.state', data: { server_id: 's-1', dm_id: null, user_id: ANA.id, state: inRoom(ANA, 'v-geral') } }))
    const card = screen.getByRole('article', { name: 'Sala geral' })
    expect(card.textContent).toContain('Squad · 1 pessoa · 41 min')
    expect(screen.queryByText('Ninguém em call agora.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Entrar em Sala geral' }))
    expect(join).toHaveBeenCalledWith('s-1', 'v-geral')

    act(() =>
      useChat.getState().applyEvent({
        type: 'voice.state',
        data: { server_id: 's-1', dm_id: null, user_id: ANA.id, state: inRoom(ANA, 'v-geral', { screen: true }) }
      })
    )
    expect(card.textContent).toContain('AO VIVO')
    expect(card.textContent).toContain('Ana transmitindo')
  })

  it('asks for thumbnails of the streaming cards only, and stops when the hub closes', async () => {
    const sent: unknown[] = []
    vi.spyOn(realtime, 'sendRealtime').mockImplementation((type, data) => {
      if (type === 'home.watch') sent.push(data)
      return true
    })
    const rooms = [voiceRoom('v-geral', 'Sala geral')]
    useChat.setState({
      servers: {
        's-1': server('s-1', 'Squad', rooms, [inRoom(ANA, 'v-geral', { screen: true })]),
        's-2': server('s-2', 'Galera', [voiceRoom('v-2', 'Outra')], [inRoom(BIA, 'v-2')])
      }
    })
    const { unmount } = render(<HomeHub me={ME} />)
    await screen.findByRole('article', { name: 'Sala geral' })
    expect(sent).toEqual([{ server_ids: ['s-1'] }])
    unmount()
    expect(sent).toEqual([{ server_ids: ['s-1'] }, { server_ids: [] }])
  })
})
