/**
 * Block 4.2.8: the server's one Addons category. Its "+" adds an addon, addons only live there and
 * nothing else goes in, it can't be renamed or deleted, and its name follows the app's language.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { Category, Channel, Me, Member, ServerDetail } from '../lib/api'
import { ADDON_DRAG_TYPE, CHANNEL_DRAG_TYPE, categoryName, defaultCategory } from '../lib/channelOrder'
import { Perm } from '../lib/permissions'
import { useChat } from '../store/chat'
import { useNav } from '../store/nav'
import { CategoryNameModal } from './CategoryModals'
import { CreateAddonModal, CreateChannelModal } from './modals'
import { CategoryMenu } from './PlaceMenus'
import { Sidebar } from './Sidebar'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))

const ME = { id: 'me', username: 'me', display_name: 'me', avatar_url: null, badges: [], email: 'me@example.com' } as unknown as Me
const SID = 's-1'

const channel = (id: string, type: Channel['type'], position: number, category_id: string | null): Channel => ({
  id,
  category_id,
  permissions_synced: true,
  server_id: SID,
  name: id,
  type,
  position,
  addon_key: type === 'addon' ? 'kanban' : null,
  config: {},
  overrides: []
})
const category = (id: string, position: number, kind: Category['kind'] = 'normal', name = id): Category => ({
  id,
  server_id: SID,
  name,
  position,
  kind,
  overrides: []
})
// The stored name doesn't matter: the app shows the addons category in its own language.
const ADDONS = category('cat-addons', 2, 'addons', 'stored-name')
const CATEGORIES = [category('Salas', 0), category('Conversas', 1), ADDONS]
const CHANNELS = [
  channel('geral', 'text', 0, 'Conversas'),
  channel('Sala', 'voice', 1, 'Salas'),
  channel('tarefas', 'addon', 2, ADDONS.id),
  channel('quadro', 'addon', 3, ADDONS.id)
]

function server(): ServerDetail {
  const member = { user: ME, role_ids: ['r-org'], joined_at: '2026-01-01T00:00:00Z', nickname: null, status: 'online', online: true } as unknown as Member
  const role = (id: string, permissions: number, position: number) =>
    ({ id, server_id: SID, name: id, color: null, icon_url: null, position, permissions, hoist: false, mentionable: false }) as never
  return {
    id: SID,
    name: 'Squad',
    icon_url: null,
    banner_url: null,
    owner_id: 'someone-else',
    created_at: '2026-01-01T00:00:00Z',
    type: 'mixed',
    roles: [role('r-org', Perm.MANAGE_CHANNELS | Perm.MANAGE_ADDONS, 1), role(SID, Perm.VIEW_CHANNEL | Perm.CONNECT, 0)],
    channels: CHANNELS,
    categories: CATEGORIES,
    members: [member],
    voice_states: [],
    reads: []
  } as unknown as ServerDetail
}

let calls: { path: string; method?: string; body?: unknown }[] = []

beforeEach(() => {
  calls = []
  vi.spyOn(api, 'api').mockImplementation(async (path, options) => {
    calls.push({ path, method: options?.method, body: options?.body })
    if (path === '/addons') return [{ key: 'kanban', name: 'Kanban', description: 'Quadro de tarefas' }]
    if (path.endsWith('/arrange')) return []
    if (path.endsWith('/channels')) return channel('novo', 'addon', 9, ADDONS.id)
    return server()
  })
  useChat.setState({ meId: ME.id, loaded: true, servers: { [SID]: server() }, order: [SID], reads: {}, messages: {} })
  useNav.setState({ place: SID })
})

function dataTransfer(): DataTransfer {
  const data = new Map<string, string>()
  return {
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    get types() {
      return [...data.keys()]
    },
    effectAllowed: 'all',
    dropEffect: 'none'
  } as unknown as DataTransfer
}

const row = (id: string): HTMLElement => document.querySelector(`[data-channel-id="${id}"]`) as HTMLElement
const header = (id: string): HTMLElement => document.querySelector(`[data-category-id="${id}"]`) as HTMLElement

describe('the addons category', () => {
  it('shows its name translated', () => {
    expect(categoryName(ADDONS)).toBe('Addons')
    expect(categoryName(CATEGORIES[0])).toBe('Salas')
    render(<Sidebar server={server()} me={ME} />)
    expect(screen.getByRole('region', { name: 'Addons' })).toBeTruthy()
    expect(screen.queryByText('stored-name')).toBeNull()
  })

  it('its "+" adds an addon, the others create a channel', async () => {
    render(<Sidebar server={server()} me={ME} />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Addons' })).getByRole('button', { name: 'Adicionar addon em Addons' }))
    expect(await screen.findByRole('dialog', { name: 'Adicionar addon' })).toBeTruthy()
    fireEvent.click(within(screen.getByRole('region', { name: 'Conversas' })).getByRole('button', { name: 'Criar canal em Conversas' }))
    expect(await screen.findByRole('dialog', { name: 'Criar canal' })).toBeTruthy()
  })

  it('adding an addon has no category to pick and goes to the addons category', async () => {
    render(<CreateAddonModal serverId={SID} onClose={() => {}} />)
    await screen.findByText('Kanban')
    expect(screen.queryByLabelText('Categoria')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ type: 'addon', category_id: ADDONS.id }))
  })

  it('creating a channel never offers the addons category', () => {
    render(<CreateChannelModal serverId={SID} initialType="text" onClose={() => {}} />)
    const options = within(screen.getByLabelText('Categoria')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Sem categoria', 'Salas', 'Conversas'])
    expect(defaultCategory(server(), 'addon')).toBe(ADDONS.id)
    expect(defaultCategory(server(), 'text')).toBe('Conversas')
  })

  it("can't be renamed or deleted, and only adds addons", () => {
    render(<CategoryMenu server={server()} category={ADDONS} meId={ME.id} />)
    expect(screen.getByText('Adicionar addon')).toBeTruthy()
    for (const label of ['Renomear', 'Excluir categoria', 'Criar canal de texto', 'Criar canal de voz']) expect(screen.queryByText(label)).toBeNull()
  })

  it('a normal category menu creates channels, not addons', () => {
    render(<CategoryMenu server={server()} category={CATEGORIES[1]} meId={ME.id} />)
    expect(screen.getByText('Criar canal de texto')).toBeTruthy()
    expect(screen.queryByText('Adicionar addon')).toBeNull()
  })

  it('says the name Addons is reserved', async () => {
    vi.spyOn(api, 'api').mockRejectedValue(new api.ApiError(409, 'The name Addons is reserved for the addons category'))
    render(<CategoryNameModal serverId={SID} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Nome da categoria'), { target: { value: 'addons' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('O nome Addons é reservado para a categoria dos addons.')).toBeTruthy()
  })
})

describe('dragging', () => {
  it('an addon carries its kind', () => {
    render(<Sidebar server={server()} me={ME} />)
    const dt = dataTransfer()
    fireEvent.dragStart(row('tarefas'), { dataTransfer: dt })
    expect(dt.types).toEqual(expect.arrayContaining([CHANNEL_DRAG_TYPE, ADDON_DRAG_TYPE]))
  })

  it('an addon moves only inside the addons category', async () => {
    render(<Sidebar server={server()} me={ME} />)
    const dt = dataTransfer()
    fireEvent.dragStart(row('tarefas'), { dataTransfer: dt })
    for (const target of [row('geral'), header('Salas')]) {
      fireEvent.dragOver(target, { dataTransfer: dt })
      expect(target.querySelector('[data-drop-indicator]')).toBeNull()
      fireEvent.drop(target, { dataTransfer: dt })
    }
    expect(calls.some((c) => c.path.endsWith('/arrange'))).toBe(false)
    fireEvent.dragOver(row('quadro'), { dataTransfer: dt })
    expect(row('quadro').querySelector('[data-drop-indicator="after"]')).toBeTruthy()
    fireEvent.drop(row('quadro'), { dataTransfer: dt })
    await waitFor(() => expect(calls.find((c) => c.path.endsWith('/arrange'))?.body).toEqual({ category_id: ADDONS.id, channel_ids: ['quadro', 'tarefas'] }))
  })

  it('a channel never goes into the addons category', () => {
    render(<Sidebar server={server()} me={ME} />)
    const dt = dataTransfer()
    fireEvent.dragStart(row('geral'), { dataTransfer: dt })
    for (const target of [row('tarefas'), header(ADDONS.id)]) {
      fireEvent.dragOver(target, { dataTransfer: dt })
      expect(target.querySelector('[data-drop-indicator]')).toBeNull()
      fireEvent.drop(target, { dataTransfer: dt })
    }
    expect(header(ADDONS.id).className).not.toContain('bg-accent/15')
    expect(calls.some((c) => c.path.endsWith('/arrange'))).toBe(false)
  })
})
