/**
 * Block 3.5: reordering channels by dragging in the sidebar or with "Mover para cima/baixo",
 * saved for the whole server and applied live.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { Channel, Me, Member, ServerDetail, User } from '../lib/api'
import { moveId, reorderDragType, stepId, withSectionOrder } from '../lib/channelOrder'
import { Perm } from '../lib/permissions'
import { useChat } from '../store/chat'
import { useNav } from '../store/nav'
import { ChannelMenu } from './PlaceMenus'
import { Sidebar } from './Sidebar'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))

const person = (id: string): User => ({ id, username: id, display_name: id, avatar_url: null, badges: [] }) as unknown as User
const ME = { ...person('me'), email: 'me@example.com' } as unknown as Me
const SID = 's-1'

const channel = (id: string, type: Channel['type'], position: number): Channel => ({
  id,
  server_id: SID,
  name: id,
  type,
  position,
  addon_key: type === 'addon' ? 'kanban' : null,
  config: {},
  overrides: []
})
// Interleaved, as positions are server-wide.
const CHANNELS = [
  channel('geral', 'text', 0),
  channel('Sala', 'voice', 1),
  channel('memes', 'text', 2),
  channel('Ranked', 'voice', 3),
  channel('avisos', 'text', 4)
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
    members: [member],
    voice_states: [],
    reads: []
  }
}

const names = (type: Channel['type']): string[] =>
  (useChat.getState().servers[SID]?.channels ?? []).filter((c) => c.type === type).map((c) => c.id)

let calls: { path: string; method?: string; body?: unknown }[] = []

beforeEach(() => {
  calls = []
  vi.spyOn(api, 'api').mockImplementation(async (path, options) => {
    calls.push({ path, method: options?.method, body: options?.body })
    if (path === `/servers/${SID}/channels/order`) {
      const ids = (options?.body as { channel_ids: string[] }).channel_ids
      return withSectionOrder(CHANNELS, ids).map((c) => ({ id: c.id, position: c.position }))
    }
    return server(true)
  })
  useChat.setState({ meId: ME.id, loaded: true, servers: { [SID]: server(true) }, order: [SID], reads: {}, messages: {} })
  useNav.setState({ place: SID })
})

describe('order helpers', () => {
  it('hands a section its own positions in the new order', () => {
    const next = withSectionOrder(CHANNELS, ['avisos', 'geral', 'memes'])
    expect(next.filter((c) => c.type === 'text').map((c) => [c.id, c.position])).toEqual([
      ['geral', 2],
      ['memes', 4],
      ['avisos', 0]
    ])
    expect(next.filter((c) => c.type === 'voice').map((c) => c.position)).toEqual([1, 3]) // untouched
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
  it('reorders right away and saves the section', async () => {
    await useChat.getState().reorderChannels(SID, 'text', ['avisos', 'geral', 'memes'])
    expect(names('text')).toEqual(['avisos', 'geral', 'memes'])
    expect(names('voice')).toEqual(['Sala', 'Ranked'])
    expect(calls).toContainEqual({
      path: `/servers/${SID}/channels/order`,
      method: 'PUT',
      body: { type: 'text', channel_ids: ['avisos', 'geral', 'memes'] }
    })
  })

  it('goes back to the saved order when the API refuses', async () => {
    vi.spyOn(api, 'api').mockImplementation(async (path) => {
      if (path.endsWith('/channels/order')) throw new api.ApiError(403, 'nope')
      return server(true)
    })
    await expect(useChat.getState().reorderChannels(SID, 'text', ['memes', 'geral', 'avisos'])).rejects.toBeTruthy()
    await waitFor(() => expect(names('text')).toEqual(['geral', 'memes', 'avisos']))
  })

  it('applies someone else’s reorder live', () => {
    useChat.getState().applyEvent({
      type: 'channels.reordered',
      data: { server_id: SID, channels: [{ id: 'Ranked', position: 1 }, { id: 'Sala', position: 3 }] }
    })
    expect(names('voice')).toEqual(['Ranked', 'Sala'])
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

  it('drags a channel within its section, showing where it lands', async () => {
    render(<Sidebar server={server(true)} me={ME} />)
    const dt = dataTransfer()
    fireEvent.dragStart(row('geral'), { dataTransfer: dt })
    expect(dt.types).toContain(reorderDragType('text'))
    // jsdom has no DragEvent, so there's no pointer position: it lands after the target.
    fireEvent.dragOver(row('memes'), { dataTransfer: dt })
    expect(row('memes').querySelector('[data-drop-indicator="after"]')).toBeTruthy()
    fireEvent.drop(row('memes'), { dataTransfer: dt })
    expect(row('memes').querySelector('[data-drop-indicator]')).toBeNull()
    await waitFor(() => expect(names('text')).toEqual(['memes', 'geral', 'avisos']))
  })

  it('ignores a channel dragged from another section', () => {
    render(<Sidebar server={server(true)} me={ME} />)
    const dt = dataTransfer()
    fireEvent.dragStart(row('Ranked'), { dataTransfer: dt })
    fireEvent.dragOver(row('geral'), { dataTransfer: dt })
    expect(row('geral').querySelector('[data-drop-indicator]')).toBeNull()
    fireEvent.drop(row('geral'), { dataTransfer: dt })
    expect(calls.some((c) => c.path.endsWith('/channels/order'))).toBe(false)
  })

  it("can't be dragged without MANAGE_CHANNELS", () => {
    useChat.setState({ servers: { [SID]: server(false) } })
    render(<Sidebar server={server(false)} me={ME} />)
    expect(row('geral')).toBeNull()
  })
})

describe('Mover para cima / para baixo', () => {
  it('moves one place within the section, and only offers what makes sense', async () => {
    const { unmount } = render(<ChannelMenu server={server(true)} channel={CHANNELS[0]} meId={ME.id} />)
    expect(screen.queryByRole('menuitem', { name: 'Mover para cima' }) ?? screen.queryByText('Mover para cima')).toBeNull()
    fireEvent.click(screen.getByText('Mover para baixo'))
    await waitFor(() => expect(names('text')).toEqual(['memes', 'geral', 'avisos']))
    unmount()

    render(<ChannelMenu server={server(false)} channel={CHANNELS[2]} meId={ME.id} />)
    const menu = document.body
    expect(within(menu).queryByText('Mover para cima')).toBeNull()
    expect(within(menu).queryByText('Mover para baixo')).toBeNull()
  })
})
