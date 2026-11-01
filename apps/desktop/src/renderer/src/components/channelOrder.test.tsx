/**
 * Blocks 3.5 and 3.12: reordering channels and categories by dragging in the sidebar or with
 * "Mover para cima/baixo", saved for the whole server and applied live.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { Category, Channel, Me, Member, ServerDetail, User } from '../lib/api'
import { CATEGORY_DRAG_TYPE, CHANNEL_DRAG_TYPE, channelGroups, defaultCategory, moveId, orderedChannels, stepId, withArrangement } from '../lib/channelOrder'
import { Perm } from '../lib/permissions'
import { useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { useNav } from '../store/nav'
import { CategoryMenu, ChannelListMenu, ChannelMenu } from './PlaceMenus'
import { Sidebar } from './Sidebar'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))

const person = (id: string): User => ({ id, username: id, display_name: id, avatar_url: null, badges: [] }) as unknown as User
const ME = { ...person('me'), email: 'me@example.com' } as unknown as Me
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
const category = (id: string, position: number): Category => ({ id, server_id: SID, name: id, position, overrides: [] })
const CATEGORIES = [category('Salas', 0), category('Conversas', 1)]
// Interleaved, as positions are server-wide.
const CHANNELS = [
  channel('topo', 'text', 0, null),
  channel('geral', 'text', 1, 'Conversas'),
  channel('Sala', 'voice', 2, 'Salas'),
  channel('memes', 'text', 3, 'Conversas'),
  channel('Ranked', 'voice', 4, 'Salas'),
  channel('avisos', 'text', 5, 'Conversas')
]

function server(canManage: boolean): ServerDetail {
  const member: Member = {
    user: ME,
    role_ids: canManage ? ['r-org'] : [],
    joined_at: '2026-01-01T00:00:00Z',
    nickname: null,
    voice_muted: false,
    voice_deafened: false,
    status: 'online',
    online: true
  }
  const role = (id: string, permissions: number, position: number) => ({
    id,
    server_id: SID,
    name: id,
    color: null,
    icon_url: null,
    position,
    permissions,
    hoist: false,
    mentionable: false
  })
  return {
    id: SID,
    name: 'Squad',
    icon_url: null,
    banner_url: null,
    owner_id: 'someone-else',
    created_at: '2026-01-01T00:00:00Z',
    roles: [role('r-org', Perm.MANAGE_CHANNELS, 1), role(SID, Perm.VIEW_CHANNEL | Perm.CONNECT, 0)],
    channels: CHANNELS,
    categories: CATEGORIES,
    members: [member],
    voice_states: [],
    reads: []
  }
}

const inCategory = (id: string | null): string[] =>
  (useChat.getState().servers[SID]?.channels ?? []).filter((c) => c.category_id === id).map((c) => c.id)

let calls: { path: string; method?: string; body?: unknown }[] = []

beforeEach(() => {
  calls = []
  vi.spyOn(api, 'api').mockImplementation(async (path, options) => {
    calls.push({ path, method: options?.method, body: options?.body })
    if (path.endsWith('/arrange') || path.endsWith('/order')) return []
    return server(true)
  })
  useChat.setState({ meId: ME.id, loaded: true, servers: { [SID]: server(true) }, order: [SID], reads: {}, messages: {} })
  useNav.setState({ place: SID })
})

describe('order helpers', () => {
  it('groups channels by category, the ones without first', () => {
    const { loose, groups } = channelGroups(server(true))
    expect(loose.map((c) => c.id)).toEqual(['topo'])
    expect(groups.map((g) => [g.category.id, g.channels.map((c) => c.id)])).toEqual([
      ['Salas', ['Sala', 'Ranked']],
      ['Conversas', ['geral', 'memes', 'avisos']]
    ])
  })

  it('treats a channel of an unknown category as having none', () => {
    const { loose } = channelGroups({ channels: [channel('x', 'text', 0, 'gone')], categories: [] })
    expect(loose.map((c) => c.id)).toEqual(['x'])
  })

  it('lists every channel in the order people see them', () => {
    expect(orderedChannels(server(true)).map((c) => c.id)).toEqual(['topo', 'Sala', 'Ranked', 'geral', 'memes', 'avisos'])
  })

  it('hands a list its own positions, and a moved channel its new category', () => {
    const next = withArrangement(CHANNELS, 'Salas', ['Ranked', 'memes', 'Sala'])
    const of = (id: string): Channel => next.find((c) => c.id === id)!
    expect([of('Ranked').position, of('memes').position, of('Sala').position]).toEqual([2, 3, 4])
    expect(of('memes').category_id).toBe('Salas')
    expect(of('geral').position).toBe(1) // untouched
  })

  it('suggests the category with channels of the type', () => {
    expect(defaultCategory(server(true), 'voice')).toBe('Salas')
    expect(defaultCategory(server(true), 'addon')).toBe('')
  })

  it('moves before or after a target, and one step at a time', () => {
    expect(moveId(['a', 'b', 'c'], 'c', 'a', false)).toEqual(['c', 'a', 'b'])
    expect(moveId(['a', 'b', 'c'], 'a', 'b', true)).toEqual(['b', 'a', 'c'])
    expect(stepId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    const edge = ['a', 'b']
    expect(stepId(edge, 'a', -1)).toBe(edge)
  })
})

describe('chat store', () => {
  it('arranges right away and saves the category', async () => {
    await useChat.getState().arrangeChannels(SID, 'Conversas', ['avisos', 'geral', 'memes'])
    expect(inCategory('Conversas')).toEqual(['avisos', 'geral', 'memes'])
    expect(inCategory('Salas')).toEqual(['Sala', 'Ranked'])
    expect(calls).toContainEqual({
      path: `/servers/${SID}/channels/arrange`,
      method: 'PUT',
      body: { category_id: 'Conversas', channel_ids: ['avisos', 'geral', 'memes'] }
    })
  })

  it('goes back to the saved order when the API refuses', async () => {
    vi.spyOn(api, 'api').mockImplementation(async (path) => {
      if (path.endsWith('/arrange')) throw new api.ApiError(403, 'nope')
      return server(true)
    })
    await expect(useChat.getState().arrangeChannels(SID, 'Conversas', ['memes', 'geral', 'avisos'])).rejects.toBeTruthy()
    await waitFor(() => expect(inCategory('Conversas')).toEqual(['geral', 'memes', 'avisos']))
  })

  it('applies someone else’s reorder live', () => {
    useChat.getState().applyEvent({
      type: 'channels.reordered',
      data: { server_id: SID, channels: [{ id: 'Ranked', position: 1 }, { id: 'Sala', position: 3 }] }
    })
    expect(inCategory('Salas')).toEqual(['Ranked', 'Sala'])
  })
})

/** A drag with a working dataTransfer (jsdom has none). */
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

describe('sidebar', () => {
  const row = (id: string): HTMLElement => document.querySelector(`[data-channel-id="${id}"]`) as HTMLElement

  const header = (id: string): HTMLElement => document.querySelector(`[data-category-id="${id}"]`) as HTMLElement

  it('shows the channels without a category first, then each category', () => {
    render(<Sidebar server={server(true)} me={ME} />)
    expect(screen.getByRole('region', { name: 'Salas' })).toBeTruthy()
    const order = [...document.querySelectorAll('[data-channel-id]')].map((el) => (el as HTMLElement).dataset.channelId)
    expect(order).toEqual(['topo', 'Sala', 'Ranked', 'geral', 'memes', 'avisos'])
  })

  it('drags a channel within its category, showing where it lands', async () => {
    render(<Sidebar server={server(true)} me={ME} />)
    const dt = dataTransfer()
    fireEvent.dragStart(row('geral'), { dataTransfer: dt })
    expect(dt.types).toContain(CHANNEL_DRAG_TYPE)
    // jsdom has no DragEvent, so there's no pointer position: it lands after the target.
    fireEvent.dragOver(row('memes'), { dataTransfer: dt })
    expect(row('memes').querySelector('[data-drop-indicator="after"]')).toBeTruthy()
    fireEvent.drop(row('memes'), { dataTransfer: dt })
    expect(row('memes').querySelector('[data-drop-indicator]')).toBeNull()
    await waitFor(() => expect(inCategory('Conversas')).toEqual(['memes', 'geral', 'avisos']))
  })

  it('drags a channel into another category, between its channels', async () => {
    render(<Sidebar server={server(true)} me={ME} />)
    const dt = dataTransfer()
    fireEvent.dragStart(row('memes'), { dataTransfer: dt })
    fireEvent.dragOver(row('Sala'), { dataTransfer: dt })
    fireEvent.drop(row('Sala'), { dataTransfer: dt })
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/arrange'))).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/arrange'))?.body).toEqual({ category_id: 'Salas', channel_ids: ['Sala', 'memes', 'Ranked'] })
    expect(inCategory('Conversas')).toEqual(['geral', 'avisos'])
  })

  it('takes a channel dropped on a category header', async () => {
    render(<Sidebar server={server(true)} me={ME} />)
    const dt = dataTransfer()
    fireEvent.dragStart(row('topo'), { dataTransfer: dt })
    fireEvent.dragOver(header('Salas'), { dataTransfer: dt })
    fireEvent.drop(header('Salas'), { dataTransfer: dt })
    await waitFor(() => expect(inCategory('Salas')).toContain('topo'))
    expect(inCategory(null)).toEqual([])
  })

  it('drags a category', async () => {
    render(<Sidebar server={server(true)} me={ME} />)
    const dt = dataTransfer()
    fireEvent.dragStart(header('Salas'), { dataTransfer: dt })
    expect(dt.types).toContain(CATEGORY_DRAG_TYPE)
    fireEvent.dragOver(header('Conversas'), { dataTransfer: dt })
    fireEvent.drop(header('Conversas'), { dataTransfer: dt })
    await waitFor(() => expect(calls).toContainEqual({ path: `/servers/${SID}/categories/order`, method: 'PUT', body: { category_ids: ['Conversas', 'Salas'] } }))
  })

  it('collapses a category per person', () => {
    const update = vi.fn()
    useAppearance.setState({ update } as never)
    render(<Sidebar server={server(true)} me={ME} />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Conversas' })).getByRole('button', { name: 'Conversas' }))
    expect(update).toHaveBeenCalledWith({ collapsed_categories: ['Conversas'] })
  })

  it('offers to create things on a right click in the empty part of the list', () => {
    render(<ChannelListMenu server={server(true)} meId={ME.id} />)
    for (const label of ['Criar canal de texto', 'Criar canal de voz', 'Criar categoria']) expect(screen.getByText(label)).toBeTruthy()
  })

  it('creates channels from a category menu, in that category', () => {
    render(<CategoryMenu server={server(true)} category={CATEGORIES[0]} meId={ME.id} />)
    expect(screen.getByText('Criar canal de texto')).toBeTruthy()
    expect(screen.getByText('Criar canal de voz')).toBeTruthy()
    expect(screen.getByText('Excluir categoria')).toBeTruthy()
    expect(screen.queryByText('Criar categoria')).toBeNull()
  })

  it('a member without the permission gets only the safe options', () => {
    render(<CategoryMenu server={server(false)} category={CATEGORIES[0]} meId={ME.id} />)
    expect(screen.queryByText('Criar canal de texto')).toBeNull()
    expect(screen.queryByText('Excluir categoria')).toBeNull()
  })

  it('hides the channels of a collapsed category', () => {
    useAppearance.setState((s) => ({ settings: { ...s.settings, collapsed_categories: ['Salas'] } }))
    render(<Sidebar server={server(true)} me={ME} />)
    expect(row('Sala')).toBeNull()
    expect(row('geral')).toBeTruthy()
    useAppearance.setState((s) => ({ settings: { ...s.settings, collapsed_categories: [] } }))
  })

  it("can't be dragged without MANAGE_CHANNELS", () => {
    useChat.setState({ servers: { [SID]: server(false) } })
    render(<Sidebar server={server(false)} me={ME} />)
    expect(row('geral')).toBeNull()
  })
})

describe('Mover para cima / para baixo', () => {
  it('moves one place within its category, and only offers what makes sense', async () => {
    const { unmount } = render(<ChannelMenu server={server(true)} channel={CHANNELS[1]} meId={ME.id} />)
    expect(screen.queryByRole('menuitem', { name: 'Mover para cima' }) ?? screen.queryByText('Mover para cima')).toBeNull()
    fireEvent.click(screen.getByText('Mover para baixo'))
    await waitFor(() => expect(inCategory('Conversas')).toEqual(['memes', 'geral', 'avisos']))
    unmount()

    render(<ChannelMenu server={server(false)} channel={CHANNELS[3]} meId={ME.id} />)
    const menu = document.body
    expect(within(menu).queryByText('Mover para cima')).toBeNull()
    expect(within(menu).queryByText('Mover para baixo')).toBeNull()
  })
})
