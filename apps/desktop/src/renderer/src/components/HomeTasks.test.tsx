/**
 * Block 3.4, "Minhas tarefas": my unfinished Kanban cards from every server, and opening one
 * right in its board.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Board } from '../addons/kanban/store'
import { KanbanPanel } from '../addons/kanban/KanbanPanel'
import * as api from '../lib/api'
import type { Channel, HomeData, HomeTask, Me, ServerDetail } from '../lib/api'
import { useChat } from '../store/chat'
import { useHome } from '../store/home'
import { useNav } from '../store/nav'
import { useSocial } from '../store/social'
import { dueLabel, HomeHub } from './HomeHub'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))

const ME = { id: 'u-me', username: 'edu', display_name: 'Edu', avatar_url: null, badges: [] } as unknown as Me

const task = (id: string, title: string, extra: Partial<HomeTask> = {}): HomeTask => ({
  id,
  addon_key: 'kanban',
  workspace_id: 'k-1',
  title,
  status: 'A fazer',
  labels: [],
  due_date: null,
  updated_at: '2026-10-21T10:00:00Z',
  server_id: 's-1',
  server_name: 'Aureum · Beta Test',
  channel_id: 'k-1',
  channel_name: 'Melhorias',
  ...extra
})
const TASKS = [
  task('t-1', 'Ícone novo', { status: 'Fazendo', labels: [{ name: 'Melhorias UI', color: 'blue' }], due_date: '2026-10-23' }),
  ...Array.from({ length: 6 }, (_, i) => task(`t-${i + 2}`, `Tarefa ${i + 2}`))
]

let home: HomeData
let calls: string[] = []

beforeEach(() => {
  calls = []
  home = { mentions: [], dms: [], tasks: TASKS.slice(0, 6), tasks_total: TASKS.length, servers: [] }
  vi.spyOn(api, 'api').mockImplementation(async (path) => {
    calls.push(path)
    if (path === '/users/me/home') return home
    if (path === '/users/me/tasks') return TASKS
    return []
  })
  useChat.setState({ meId: ME.id, loaded: true, servers: {}, order: [], reads: {}, messages: {} })
  useSocial.setState({ meId: ME.id, loaded: true, friends: {}, dms: {}, presence: {}, missed: [] })
  useNav.setState({ place: 'home', homePage: 'hub', addonItem: null })
  return () => useHome.setState({ loaded: false, tasks: [], tasksTotal: 0 })
})

describe('dueLabel', () => {
  it('flags overdue in danger and the next two days in idle', () => {
    const today = new Date(2026, 9, 21, 15, 0)
    expect(dueLabel('2026-10-20', today)).toEqual({ text: '20 out · atrasado', tone: 'danger' })
    expect(dueLabel('2026-10-21', today)).toEqual({ text: '21 out · hoje', tone: 'idle' })
    expect(dueLabel('2026-10-22', today)).toEqual({ text: '22 out · amanhã', tone: 'idle' })
    expect(dueLabel('2026-10-23', today)).toEqual({ text: '23 out · em 2 dias', tone: 'idle' })
    expect(dueLabel('2026-11-30', today)).toEqual({ text: '30 nov', tone: 'muted' })
  })
})

describe('Minhas tarefas', () => {
  const section = async (): Promise<HTMLElement> => {
    render(<HomeHub me={ME} />)
    const el = screen.getByRole('region', { name: 'Minhas tarefas' })
    await within(el).findByText('Ícone novo')
    return el
  }

  it('shows the first six with labels, column, due date and where they are', async () => {
    const el = await section()
    expect(within(el).getAllByRole('listitem')).toHaveLength(6)
    const first = within(el).getAllByRole('listitem')[0].textContent ?? ''
    expect(first).toContain('Melhorias UI')
    expect(first).toContain('Fazendo')
    expect(first).toContain('23 out')
    expect(first).toContain('Aureum · Beta Test › Melhorias')
  })

  it('opens the card in its board', async () => {
    const openTab = vi.fn()
    useNav.setState({ openTab } as never)
    const el = await section()
    fireEvent.click(within(el).getByRole('button', { name: /Ícone novo/ }))
    expect(useNav.getState().place).toBe('s-1')
    expect(openTab).toHaveBeenCalledWith('s-1', 'channel:k-1')
    expect(useNav.getState().addonItem).toEqual({ channelId: 'k-1', itemId: 't-1' })
  })

  it('lists them all on Ver todas', async () => {
    const el = await section()
    fireEvent.click(within(el).getByRole('button', { name: 'Ver todas (7)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Minhas tarefas' })
    await within(dialog).findByText('Tarefa 7')
    expect(calls).toContain('/users/me/tasks')
  })

  it('says when there is nothing', async () => {
    home = { ...home, tasks: [], tasks_total: 0 }
    render(<HomeHub me={ME} />)
    expect(await screen.findByText('Nenhuma tarefa com você.')).toBeTruthy()
  })
})

describe('Kanban opened on a card', () => {
  it('shows the card picked in Home, once', async () => {
    const board: Board = {
      columns: [{ id: 'col', name: 'A fazer', stage: 'todo', position: 0 }],
      labels: [],
      cards: [
        {
          id: 't-1',
          column_id: 'col',
          title: 'Ícone novo',
          description: '',
          assignee_id: ME.id,
          label_ids: [],
          due_date: null,
          position: 0,
          created_by: null,
          created_at: '2026-10-21T10:00:00Z',
          updated_at: '2026-10-21T10:00:00Z'
        }
      ],
      can_edit: false,
      can_manage: false
    }
    vi.spyOn(api, 'api').mockResolvedValue(board)
    const channel = { id: 'k-1', server_id: 's-1', name: 'Melhorias', type: 'addon', addon_key: 'kanban', overrides: [] } as unknown as Channel
    const server = { id: 's-1', members: [], roles: [], channels: [channel] } as unknown as ServerDetail
    const opened = vi.fn()
    render(<KanbanPanel server={server} channel={channel} me={ME} perms={0} openItem="t-1" onItemOpened={opened} />)
    expect(await screen.findByRole('dialog', { name: 'Ícone novo' })).toBeTruthy()
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1))
  })
})
