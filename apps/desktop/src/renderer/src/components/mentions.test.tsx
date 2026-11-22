/**
 * Mentions in the message box: "@" lists people who see the channel, roles that may be mentioned
 * and, with the permission, @all and @here. A role is sent as its token and shown by name.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { Channel, Me, Member, Message, Role, ServerDetail } from '../lib/api'
import { mentionOptions, mentionQueryAt, plainMentions, withRoleTokens } from '../lib/mentions'
import { Perm } from '../lib/permissions'
import { useChat } from '../store/chat'
import { ChatView } from './ChatView'

const ME = { id: 'me', username: 'eduardo', display_name: 'Eduardo', avatar_url: null, badges: [], email: 'e@example.com' } as unknown as Me
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))

const SID = 's-1'
const ROLE_OPEN = 'aaaaaaaa-0000-4000-8000-000000000001'
const ROLE_STAFF = 'aaaaaaaa-0000-4000-8000-000000000002'
const user = (id: string, username: string, display_name: string) => ({ id, username, display_name, avatar_url: null, badges: [] })
const member = (id: string, username: string, name: string, role_ids: string[] = []): Member =>
  ({ user: user(id, username, name), role_ids, joined_at: '2026-01-01T00:00:00Z', nickname: null }) as unknown as Member
const role = (id: string, name: string, permissions: number, position: number, mentionable = false): Role =>
  ({ id, server_id: SID, name, color: null, icon_url: null, position, permissions, hoist: false, mentionable }) as Role
const CHAT: Channel = { id: 'c-1', server_id: SID, name: 'geral', type: 'text', position: 0, category_id: null, permissions_synced: true, addon_key: null, config: {}, overrides: [] } as never

function server(owner: string): ServerDetail {
  return {
    id: SID,
    name: 'Squad',
    owner_id: owner,
    roles: [
      role(SID, '@everyone', Perm.VIEW_CHANNEL | Perm.SEND_MESSAGES | Perm.READ_HISTORY, 0),
      role(ROLE_OPEN, 'Jogadores', 0, 1, true),
      role(ROLE_STAFF, 'Staff', 0, 2)
    ],
    channels: [CHAT],
    categories: [],
    members: [member('me', 'eduardo', 'Eduardo'), member('ana', 'ana', 'Ana Silva', [ROLE_OPEN]), member('bia', 'bia', 'Bia')],
    voice_states: [],
    reads: []
  } as unknown as ServerDetail
}

let sent: unknown[] = []
function setup(owner = 'me'): void {
  sent = []
  vi.spyOn(api, 'api').mockImplementation(async (path, options) => {
    if (options?.method === 'POST' && path.endsWith('/messages')) {
      sent.push(options.body)
      return { id: 1, channel_id: CHAT.id, author: ME, content: (options.body as { content: string }).content, attachments: [], created_at: '2026-11-22T00:00:00Z', edited_at: null }
    }
    return []
  })
  useChat.setState({
    meId: ME.id,
    loaded: true,
    servers: { [SID]: server(owner) },
    messages: { [CHAT.id]: { items: [], hasMore: false, loaded: true, loading: false } }
  })
}

const box = (): HTMLTextAreaElement => screen.getByRole('textbox') as HTMLTextAreaElement
const type = (text: string): void => void fireEvent.change(box(), { target: { value: text } })
const options = (): string[] => within(screen.getByRole('listbox', { name: 'Quem marcar' })).getAllByRole('option').map((o) => o.textContent ?? '')

describe('mention helpers', () => {
  it('finds the "@" being typed', () => {
    expect(mentionQueryAt('oi @an', 6)).toEqual({ query: 'an', start: 3 })
    expect(mentionQueryAt('@', 1)).toEqual({ query: '', start: 0 })
    expect(mentionQueryAt('mail@x', 6)).toBeNull()
  })

  it('matches names without accents, and by any word', () => {
    const people = [{ user: user('a', 'ana', 'Ana Silva') as never, name: 'Ana Silva' }, { user: user('j', 'joao', 'João') as never, name: 'João' }]
    const keys = (q: string) => mentionOptions(q, { people, roles: [], everyone: false }, 8).map((o) => o.key)
    expect(keys('silva')).toEqual(['u:a'])
    expect(keys('joa')).toEqual(['u:j'])
    expect(keys('al')).toEqual([])
  })

  it('turns picked roles into tokens, the longer name first, and reads them back', () => {
    const roles = [role('r1', 'Time', 0, 1), role('r2', 'Time A', 0, 2)]
    expect(withRoleTokens('@Time A e @Time, não @Timeless', roles)).toBe('<@&r2> e <@&r1>, não @Timeless')
    expect(plainMentions(`oi <@&${ROLE_OPEN}>`, (id) => (id === ROLE_OPEN ? 'Jogadores' : undefined), 'cargo')).toBe('oi @Jogadores')
  })
})

describe('the message box', () => {
  beforeEach(() => setup())

  it('lists @all, @here, people and roles when "@" is typed', () => {
    render(<ChatView channel={CHAT} me={ME} canModerate={false} />)
    type('@')
    const list = options()
    expect(list[0]).toContain('@all')
    expect(list[1]).toContain('@here')
    expect(list.some((o) => o.includes('Ana Silva'))).toBe(true)
    expect(list.some((o) => o.includes('@Staff'))).toBe(true)
    // Never yourself.
    expect(list.some((o) => o.includes('@eduardo'))).toBe(false)
  })

  it('Enter puts the person in the text', () => {
    render(<ChatView channel={CHAT} me={ME} canModerate={false} />)
    type('oi @sil')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(box().value).toBe('oi @ana ')
  })

  it('a role reads by name while typing and goes as its token', async () => {
    render(<ChatView channel={CHAT} me={ME} canModerate={false} />)
    type('@jog')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(box().value).toBe('@Jogadores ')
    type('@Jogadores bora?')
    await act(async () => void fireEvent.keyDown(box(), { key: 'Enter' }))
    expect(sent).toEqual([{ content: `<@&${ROLE_OPEN}> bora?`, attachment_ids: [] }])
  })

  it('without the permission: no @all, @here or roles that are not mentionable', () => {
    setup('someone-else')
    render(<ChatView channel={CHAT} me={ME} canModerate={false} />)
    type('@')
    const list = options()
    expect(list.some((o) => o.includes('@all') || o.includes('@here') || o.includes('@Staff'))).toBe(false)
    expect(list.some((o) => o.includes('@Jogadores'))).toBe(true)
  })

  it('Esc closes the list', () => {
    render(<ChatView channel={CHAT} me={ME} canModerate={false} />)
    type('@a')
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: 'Quem marcar' })).toBeNull()
  })
})

describe('in a message', () => {
  beforeEach(() => setup())

  it('shows a role by name, and @all as a mention', () => {
    const message = { id: 5, channel_id: CHAT.id, author: user('ana', 'ana', 'Ana'), content: `<@&${ROLE_OPEN}> e @all, partida às 20h`, attachments: [], created_at: '2026-11-22T00:00:00Z', edited_at: null } as unknown as Message
    useChat.setState({ messages: { [CHAT.id]: { items: [message], hasMore: false, loaded: true, loading: false } } })
    render(<ChatView channel={CHAT} me={ME} canModerate={false} />)
    expect(screen.getByText('@Jogadores')).toBeTruthy()
    expect(screen.getByTitle('Todos que veem este canal').textContent).toBe('@all')
    expect(screen.queryByText(new RegExp(ROLE_OPEN))).toBeNull()
  })
})
