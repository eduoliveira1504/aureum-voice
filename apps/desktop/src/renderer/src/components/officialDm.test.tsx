/**
 * Block 3.3 in the app: @aureum's official DM (read-only, pinned, its own look), its messages
 * (simple markdown and channel mentions, only when the author really is official), Configurações ›
 * Notificações and "Fechar (não é bug)".
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { BugReport, Channel, Dm, Me, Message, ReadState, ServerDetail, User } from '../lib/api'
import { useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { useNav } from '../store/nav'
import { useSocial } from '../store/social'
import { BugReports } from './BugReports'
import { DmView } from './DmView'
import { NotificationSettings } from './NotificationSettings'
import { Sidebar } from './Sidebar'

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

const ME: Me = { ...person('u-me', 'eduardo'), email: 'eduardo@example.com', is_app_owner: true, email_verified: true, must_change_password: false }
const AUREUM = person('u-aureum', 'aureum', { display_name: 'Aureum', is_official: true, is_verified: true, is_bot: true })
const FAKE = person('u-fake', 'fake', { display_name: 'Aureum Fake' })
const ANA = person('u-ana', 'ana')
const SID = 's-1'
const BUGS: Channel = { id: '0b5d9a1e-1111-4c2b-9d3e-123456789abc', server_id: SID, name: 'bugs', type: 'text', position: 1, addon_key: null, config: {}, overrides: [] }

const read = (id: string): ReadState => ({ channel_id: id, last_read_message_id: 0, unread_count: 0, mention_count: 0 })
const dm = (id: string, other: User, extra: Partial<Dm> = {}): Dm => ({
  id,
  type: 'dm',
  name: null,
  icon_url: null,
  members: [
    { user: ME, status: 'online' },
    { user: other, status: 'online' }
  ],
  last_message_id: 1,
  read: read(id),
  call: null,
  voice_states: [],
  ...extra
})
const OFFICIAL = dm('d-official', AUREUM, { official: true, last_message_id: 1 })
const WITH_ANA = dm('d-ana', ANA, { last_message_id: 9 })
const WITH_FAKE = dm('d-fake', FAKE, { last_message_id: 5 })

const message = (id: number, channelId: string, author: User, content: string, official: Message['official'] = null): Message => ({
  id,
  channel_id: channelId,
  author,
  content,
  attachments: [],
  created_at: '2026-10-20T12:00:00Z',
  edited_at: null,
  call: null,
  official
})

function seed(): void {
  const server = { id: SID, name: 'Aureum Beta', channels: [BUGS], members: [], roles: [] } as unknown as ServerDetail
  useChat.setState({
    meId: ME.id,
    loaded: true,
    servers: { [SID]: server },
    order: [SID],
    reads: {},
    messages: {
      [OFFICIAL.id]: {
        items: [message(1, OFFICIAL.id, AUREUM, `**Sua senha foi alterada** agora. Bugs vão no <#${BUGS.id}>.`, { category: 'seguranca' })],
        hasMore: false,
        loaded: true,
        loading: false
      },
      [WITH_FAKE.id]: {
        items: [message(2, WITH_FAKE.id, FAKE, '**Sua senha foi alterada**', { category: 'seguranca' })],
        hasMore: false,
        loaded: true,
        loading: false
      }
    }
  })
  useSocial.setState({
    friends: {
      [ANA.id]: { user: ANA, kind: 'friend', since: '2026-01-01T00:00:00Z', status: 'online' },
      [FAKE.id]: { user: FAKE, kind: 'friend', since: '2026-01-01T00:00:00Z', status: 'online' }
    },
    dms: { [WITH_ANA.id]: WITH_ANA, [OFFICIAL.id]: OFFICIAL, [WITH_FAKE.id]: WITH_FAKE }
  })
}

describe('official DM', () => {
  beforeEach(() => {
    seed()
    vi.spyOn(api, 'api').mockResolvedValue([])
  })

  it('is read-only, says how to reach the team, and never asks for a password', () => {
    render(<DmView dm={OFFICIAL} me={ME} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText(/Esta é uma conversa oficial do Aureum\. Pra falar com a gente/)).toBeTruthy()
    expect(screen.getByText('O Aureum nunca pede sua senha ou código.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ligar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adicionar pessoas' })).toBeNull()
  })

  it('renders markdown and channel mentions in @aureum messages, and opens the channel', () => {
    const openTab = vi.fn()
    useNav.setState({ openTab } as never)
    render(<DmView dm={OFFICIAL} me={ME} />)
    expect(screen.getByText('Sua senha foi alterada').tagName).toBe('STRONG')
    fireEvent.click(screen.getByRole('button', { name: '#bugs' }))
    expect(openTab).toHaveBeenCalledWith(SID, `channel:${BUGS.id}`)
  })

  it('gives nobody else the official look, whatever they write', () => {
    render(<DmView dm={WITH_FAKE} me={ME} />)
    expect(screen.getByText('**Sua senha foi alterada**')).toBeTruthy() // plain text, no bold
    expect(screen.queryByText('O Aureum nunca pede sua senha ou código.')).toBeNull()
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('is pinned on top of the DM list', () => {
    useNav.setState({ place: 'home', homePage: 'friends' } as never)
    render(<Sidebar server={null} me={ME} />)
    const list = screen.getByText('Mensagens diretas').closest('section') ?? document.body
    const names = within(list as HTMLElement)
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((t) => /Aureum|Ana/.test(t))
    expect(names[0]).toContain('Aureum')
  })
})

describe('Configurações › Notificações', () => {
  it('turns categories off (stored as false) and back on, but never security', () => {
    const updateEntry = vi.fn()
    useAppearance.setState({ updateEntry } as never)
    render(<NotificationSettings />)
    const toggle = (title: string): HTMLInputElement => screen.getByRole('checkbox', { name: new RegExp(`^${title}`) }) as HTMLInputElement
    expect(toggle('Segurança').disabled).toBe(true)
    fireEvent.click(toggle('Novidades'))
    expect(updateEntry).toHaveBeenCalledWith('official_dm', 'novidades', false)
  })
})

describe('bug reports', () => {
  it('closes a report as "não é bug"', async () => {
    const report: BugReport = {
      id: 'r-1', author: ANA, description: 'Tela preta', app_version: '0.2.0', os: 'Windows 11', logs: '',
      screenshot_url: null, resolved_at: null, dismissed_at: null, created_at: '2026-10-20T12:00:00Z'
    }
    const call = vi.spyOn(api, 'api').mockImplementation(async (_path, options) =>
      options?.method === 'PATCH' ? { ...report, dismissed_at: '2026-10-20T13:00:00Z' } : [report]
    )
    render(<BugReports />)
    fireEvent.click(await screen.findByRole('button', { name: 'Fechar (não é bug)' }))
    await waitFor(() => expect(call).toHaveBeenCalledWith('/bug-reports/r-1', { method: 'PATCH', body: { dismissed: true } }))
    fireEvent.click(screen.getByRole('radio', { name: /Fechados/ }))
    expect(await screen.findByText('Não é bug')).toBeTruthy()
  })
})
