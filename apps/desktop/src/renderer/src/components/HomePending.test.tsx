/**
 * Block 3.4, "Pra você ver": mentions, unread DMs, missed calls and friend requests in the Home
 * hub, "Marcar tudo como lido", and opening a conversation right at the message.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { Call, Channel, Dm, HomeData, Me, Message, ServerDetail, User } from '../lib/api'
import { useChat } from '../store/chat'
import { useHome } from '../store/home'
import { useNav } from '../store/nav'
import { useSocial } from '../store/social'
import { ChatView } from './ChatView'
import { ago, HomeHub, previewOf } from './HomeHub'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))

const person = (id: string, username: string): User =>
  ({ id, username, display_name: username[0].toUpperCase() + username.slice(1), avatar_url: null, badges: [] }) as unknown as User
const ME = { ...person('u-me', 'edu'), email: 'edu@example.com', is_app_owner: false, email_verified: true, must_change_password: false } as Me
const ANA = person('u-ana', 'ana')
const BIA = person('u-bia', 'bia')
const PRADO = person('u-prado', 'prado')
const DANI = person('u-dani', 'daniboy')

const BUGS: Channel = { id: 'c-bugs', server_id: 's-1', name: 'bugs', type: 'text', position: 0, addon_key: null, config: {}, overrides: [] }
const SERVER = {
  id: 's-1',
  name: 'Aureum Beta',
  owner_id: 'x',
  roles: [],
  channels: [BUGS],
  members: [{ user: DANI, role_ids: [], nickname: null }],
  voice_states: [],
  reads: []
} as unknown as ServerDetail

const msg = (id: number, channelId: string, author: User, minutesAgo: number, extra: Partial<Message> = {}): Message => ({
  id,
  channel_id: channelId,
  author,
  content: `mensagem ${id}`,
  attachments: [],
  created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  edited_at: null,
  call: null,
  ...extra
})
const dm = (id: string, other: User): Dm =>
  ({ id, type: 'dm', name: null, icon_url: null, members: [{ user: ME }, { user: other }], last_message_id: 1, call: null, voice_states: [] }) as unknown as Dm
const read = (channelId: string, unread: number, mentions = 0): api.ReadState => ({
  channel_id: channelId,
  last_read_message_id: 0,
  unread_count: unread,
  mention_count: mentions
})

const MENTION = msg(10, BUGS.id, DANI, 12, { content: '@edu o conta-gotas ainda trava aqui' })
const VOICE = msg(20, 'd-ana', ANA, 25, {
  content: '',
  attachments: [{ id: 'a', kind: 'voice', filename: 'voz.webm', duration_ms: 42_000 } as Message['attachments'][number]]
})
const HOME: HomeData = {
  mentions: [{ server_id: 's-1', message: MENTION }],
  dms: [{ channel_id: 'd-ana', unread_count: 3, message: VOICE }],
  tasks: [],
  tasks_total: 0,
  servers: []
}
const MISSED = {
  id: 'call-1',
  channel_id: 'd-prado',
  started_by: PRADO.id,
  started_at: new Date(Date.now() - 40 * 60_000).toISOString(),
  ended_at: null,
  participants: []
} as Call

let calls: { path: string; method?: string }[] = []

beforeEach(() => {
  calls = []
  vi.spyOn(api, 'api').mockImplementation(async (path, options) => {
    calls.push({ path, method: options?.method })
    if (path === '/users/me/home') return HOME
    if (path === '/users/me/home/read') return [read(BUGS.id, 0), read('d-ana', 0)]
    return []
  })
  useChat.setState({
    meId: ME.id,
    loaded: true,
    servers: { 's-1': SERVER },
    order: ['s-1'],
    messages: {},
    focus: null,
    reads: { [BUGS.id]: read(BUGS.id, 2, 1), 'd-ana': read('d-ana', 3) }
  })
  useSocial.setState({
    meId: ME.id,
    loaded: true,
    dms: { 'd-ana': dm('d-ana', ANA), 'd-prado': dm('d-prado', PRADO) },
    friends: { [BIA.id]: { user: BIA, kind: 'incoming', since: new Date(Date.now() - 90 * 60_000).toISOString(), status: 'offline' } },
    presence: {},
    missed: [MISSED]
  })
  useNav.setState({ place: 'home', homePage: 'hub' })
  return () => useHome.setState({ loaded: false, mentions: [], dmPreviews: {} })
})

describe('helpers', () => {
  it('says how long ago, short', () => {
    const now = new Date(2026, 9, 21, 15, 0).getTime()
    const at = (d: Date): string => ago(d.toISOString(), now)
    expect(at(new Date(2026, 9, 21, 14, 48))).toBe('12 min')
    expect(at(new Date(2026, 9, 21, 12, 0))).toBe('3 h')
    expect(at(new Date(2026, 9, 20, 9, 0))).toBe('ontem')
    expect(at(new Date(2026, 9, 18, 9, 0))).toBe('18/10')
  })

  it('previews a voice message with its length', () => {
    expect(previewOf(VOICE)).toBe('Mensagem de voz · 0:42')
    expect(previewOf(MENTION)).toBe('@edu o conta-gotas ainda trava aqui')
  })
})

describe('Pra você ver', () => {
  const section = async (): Promise<HTMLElement> => {
    render(<HomeHub me={ME} />)
    const el = screen.getByRole('region', { name: 'Pra você ver' })
    await within(el).findByText(/mencionou você em/)
    return el
  }

  it('lists everything waiting, newest first', async () => {
    const el = await section()
    const rows = within(el).getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(rows[0]).toContain('Daniboy mencionou você em #bugs')
    expect(rows[0]).toContain('“@edu o conta-gotas ainda trava aqui” · Aureum Beta')
    expect(rows[1]).toContain('Ana mandou 3 mensagens')
    expect(rows[1]).toContain('Mensagem de voz · 0:42')
    expect(rows[2]).toContain('Chamada perdida de Prado')
    expect(rows[3]).toContain('@bia quer ser seu amigo')
  })

  it('opens the mention in its channel, at the message', async () => {
    const openTab = vi.fn()
    useNav.setState({ openTab } as never)
    const el = await section()
    fireEvent.click(within(el).getByRole('button', { name: /mencionou você/ }))
    expect(useNav.getState().place).toBe('s-1')
    expect(openTab).toHaveBeenCalledWith('s-1', `channel:${BUGS.id}`)
    expect(useChat.getState().focus).toEqual({ channelId: BUGS.id, messageId: 10 })
  })

  it('accepts and declines friend requests', async () => {
    const accept = vi.fn(async () => {})
    const remove = vi.fn(async () => {})
    useSocial.setState({ accept, remove } as never)
    const el = await section()
    fireEvent.click(within(el).getByRole('button', { name: 'Aceitar' }))
    expect(accept).toHaveBeenCalledWith(BIA.id)
    // Both buttons wait for the request to leave the list.
    expect((within(el).getByRole('button', { name: 'Recusar' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()

    const again = await section()
    fireEvent.click(within(again).getByRole('button', { name: 'Recusar' }))
    expect(remove).toHaveBeenCalledWith(BIA.id)
  })

  it('marks everything read, leaving what needs an answer', async () => {
    const el = await section()
    fireEvent.click(within(el).getByRole('button', { name: 'Marcar tudo como lido' }))
    await waitFor(() => expect(calls).toContainEqual({ path: '/users/me/home/read', method: 'POST' }))
    await waitFor(() => expect(within(el).queryByText(/mencionou você/)).toBeNull())
    expect(within(el).queryByText(/mandou 3 mensagens/)).toBeNull()
    expect(within(el).getByText(/quer ser seu amigo/)).toBeTruthy()
  })

  it('says when nothing is pending', async () => {
    useChat.setState({ reads: {} })
    useSocial.setState({ friends: {}, missed: [] })
    render(<HomeHub me={ME} />)
    expect(await screen.findByText('Nada pendente por aqui.')).toBeTruthy()
  })

  it('drops a mention once its channel is read elsewhere', async () => {
    const el = await section()
    act(() => {
      useChat.getState().applyEvent({ type: 'read.updated', data: { ...read(BUGS.id, 0), last_read_message_id: 10, server_id: 's-1' } })
      useHome.getState().applyEvent({ type: 'read.updated', data: { ...read(BUGS.id, 0), last_read_message_id: 10, server_id: 's-1' } })
    })
    expect(within(el).queryByText(/mencionou você/)).toBeNull()
  })
})

describe('opening a conversation at a message', () => {
  it('scrolls to it, loading older pages if needed', async () => {
    const scrolled: string[] = []
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolled.push(this.getAttribute('data-message-id') ?? '')
    })
    const older = Array.from({ length: 3 }, (_, i) => msg(i + 1, BUGS.id, DANI, 100 - i))
    const recent = Array.from({ length: 50 }, (_, i) => msg(i + 100, BUGS.id, DANI, 50 - i))
    vi.spyOn(api, 'api').mockImplementation(async (path) => (String(path).includes('before=100') ? older : String(path).includes('/messages') ? recent : []))
    useChat.setState({ messages: {}, focus: { channelId: BUGS.id, messageId: 2 } })
    render(<ChatView channel={BUGS} me={ME} canModerate={false} />)
    await waitFor(() => expect(scrolled).toEqual(['2']))
    expect(useChat.getState().focus).toBeNull()
  })
})
