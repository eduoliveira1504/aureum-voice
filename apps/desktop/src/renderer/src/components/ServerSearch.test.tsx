/** Block 4.2.4: searching a server, its filters, paging, and jumping to a result. */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { Channel, Me, Member, Message, ServerDetail } from '../lib/api'
import { useChat } from '../store/chat'
import { useNav } from '../store/nav'
import { searchQuery, ServerSearchModal } from './ServerSearch'
import { Sidebar } from './Sidebar'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))

const ME = { id: 'me', username: 'me', display_name: 'Eu', avatar_url: null, badges: [], email: 'me@example.com' } as unknown as Me
const SID = 's-1'
const user = (id: string, display_name: string) => ({ id, username: id, display_name, avatar_url: null, badges: [] })
const member = (id: string, name: string): Member => ({ user: user(id, name), role_ids: [], joined_at: '2026-01-01T00:00:00Z', nickname: null }) as unknown as Member
const channel = (id: string, type: Channel['type'], position: number): Channel =>
  ({ id, server_id: SID, name: id, type, position, category_id: null, permissions_synced: true, addon_key: null, config: {}, overrides: [] }) as Channel

const SERVER = {
  id: SID,
  name: 'Squad',
  icon_url: null,
  banner_url: null,
  owner_id: 'someone-else',
  created_at: '2026-01-01T00:00:00Z',
  type: 'mixed',
  roles: [],
  channels: [channel('geral', 'text', 0), channel('Sala', 'voice', 1), channel('quadro', 'addon', 2)],
  categories: [],
  members: [member('me', 'Eu'), member('ana', 'Ana'), member('bia', 'Bia')],
  voice_states: [],
  reads: []
} as unknown as ServerDetail

const message = (id: number, content: string, author = 'ana', channel_id = 'geral'): Message =>
  ({ id, channel_id, author: user(author, author === 'ana' ? 'Ana' : 'Bia'), content, attachments: [], created_at: '2026-11-20T15:00:00Z', edited_at: null }) as unknown as Message

let calls: string[] = []
let pages: { messages: Message[]; next_before: number | null }[] = []

beforeEach(() => {
  calls = []
  pages = []
  vi.spyOn(api, 'api').mockImplementation(async (path) => {
    calls.push(path)
    if (path.includes('/search?')) return pages.shift() ?? { messages: [], next_before: null }
    return SERVER
  })
  useChat.setState({ meId: ME.id, loaded: true, servers: { [SID]: SERVER }, order: [SID], reads: {}, messages: {}, focus: null })
  useNav.setState({ place: SID })
})

const params = (path: string): URLSearchParams => new URLSearchParams(path.split('?')[1])
const type = (value: string): void => void fireEvent.change(screen.getByPlaceholderText('Buscar mensagens'), { target: { value } })
const submit = async (): Promise<void> => {
  await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Buscar' })))
}

describe('server search', () => {
  it('opens from the sidebar', () => {
    render(<Sidebar server={SERVER} me={ME} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buscar no servidor' }))
    expect(screen.getByRole('dialog', { name: 'Buscar em Squad' })).toBeTruthy()
  })

  it('an empty field explains what to do and searches nothing', () => {
    render(<ServerSearchModal server={SERVER} onClose={() => {}} />)
    expect(screen.getByText('Digite uma palavra para procurar nas conversas que você pode ver.')).toBeTruthy()
    type('   ')
    expect((screen.getByRole('button', { name: 'Buscar' }) as HTMLButtonElement).disabled).toBe(true)
    expect(calls).toEqual([])
  })

  it('lists results, and one opens its channel at the message', async () => {
    pages = [{ messages: [message(9, 'vamos jogar hoje')], next_before: null }]
    const onClose = vi.fn()
    render(<ServerSearchModal server={SERVER} onClose={onClose} />)
    type('jogar')
    await submit()
    expect(params(calls[0]).get('q')).toBe('jogar')
    fireEvent.click(await screen.findByText('vamos jogar hoje'))
    expect(useChat.getState().focus).toEqual({ channelId: 'geral', messageId: 9 })
    expect(onClose).toHaveBeenCalled()
  })

  it('says when nothing was found', async () => {
    render(<ServerSearchModal server={SERVER} onClose={() => {}} />)
    type('pizza')
    await submit()
    expect(await screen.findByText('Nada encontrado.')).toBeTruthy()
  })

  it('filters by channel and author, searching again, and offers only channels with chat', async () => {
    render(<ServerSearchModal server={SERVER} onClose={() => {}} />)
    const options = [...(screen.getByLabelText('Canal') as HTMLSelectElement).options].map((o) => o.textContent)
    expect(options).toEqual(['Todos os canais', '#geral', 'Sala'])
    type('oi')
    await act(async () => void fireEvent.change(screen.getByLabelText('Canal'), { target: { value: 'geral' } }))
    await act(async () => void fireEvent.change(screen.getByLabelText('Autor'), { target: { value: 'bia' } }))
    const last = params(calls.at(-1)!)
    expect(last.get('channel_id')).toBe('geral')
    expect(last.get('author_id')).toBe('bia')
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    await waitFor(() => expect(params(calls.at(-1)!).get('author_id')).toBeNull())
  })

  it('sends the dates as whole local days', () => {
    const query = new URLSearchParams(searchQuery('oi', { channel: '', author: '', since: '2026-11-01', until: '2026-11-10' }))
    expect(query.get('since')).toBe(new Date('2026-11-01T00:00:00').toISOString())
    // "Até" includes the whole day.
    expect(query.get('until')).toBe(new Date('2026-11-11T00:00:00').toISOString())
  })

  it('loads more with the cursor and keeps what was shown', async () => {
    pages = [
      { messages: [message(9, 'teste nove')], next_before: 9 },
      { messages: [message(3, 'teste três')], next_before: null }
    ]
    render(<ServerSearchModal server={SERVER} onClose={() => {}} />)
    type('teste')
    await submit()
    await act(async () => void fireEvent.click(await screen.findByRole('button', { name: 'Carregar mais' })))
    expect(params(calls.at(-1)!).get('before')).toBe('9')
    expect(screen.getByText('teste nove')).toBeTruthy()
    expect(screen.getByText('teste três')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull()
  })

  it('explains the limit when searching too much', async () => {
    vi.spyOn(api, 'api').mockRejectedValue(new api.ApiError(429, 'Too many attempts'))
    render(<ServerSearchModal server={SERVER} onClose={() => {}} />)
    type('oi')
    await submit()
    expect(await screen.findByText('Muitas buscas seguidas. Espere um minuto.')).toBeTruthy()
  })
})
