import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type Channel, type Me, type ServerDetail } from '../../lib/api'
import { editedLabel } from './bits'
import { useWhiteboard, type BoardSummary } from './store'
import { WhiteboardPanel } from './WhiteboardPanel'

vi.mock('../../lib/api', async (original) => ({ ...(await original<object>()), api: vi.fn(), fetchMedia: vi.fn(() => new Promise(() => {})) }))

const NOW = new Date('2026-10-25T15:00:00Z').getTime()

const board = (id: string, name: string, extra: Partial<BoardSummary> = {}): BoardSummary => ({
  id,
  name,
  background: 'plain',
  version: 1,
  thumbnail: null,
  created_by: 'u1',
  updated_by: 'u1',
  created_at: '2026-10-25T14:00:00Z',
  updated_at: '2026-10-25T14:55:00Z',
  archived_at: null,
  ...extra
})

const server = {
  id: 's1',
  members: [{ user: { id: 'u1', display_name: 'Ana' }, nickname: null, role_ids: [] }]
} as unknown as ServerDetail
const channel = { id: 'c1', type: 'addon', addon_key: 'whiteboard', name: 'Quadros' } as unknown as Channel
const me = { id: 'u1' } as Me

function show(boards: BoardSummary[], canEdit = true): void {
  vi.mocked(api).mockResolvedValue({ boards, can_edit: canEdit })
  render(<WhiteboardPanel server={server} channel={channel} me={me} perms={0} />)
}

beforeEach(() => {
  useWhiteboard.setState({ lists: {} })
  vi.mocked(api).mockReset()
})
afterEach(cleanup)

describe('whiteboard list', () => {
  it('shows the boards, with archived ones apart', async () => {
    show([board('b1', 'Ideias'), board('b2', 'Velho', { archived_at: '2026-10-20T10:00:00Z' })])
    expect(await screen.findByText('Ideias')).toBeTruthy()
    expect(screen.getByText('1 quadro')).toBeTruthy()
    expect(screen.queryByText('Velho')).toBeNull()
    fireEvent.click(screen.getByText(/Arquivados \(1\)/))
    expect(screen.getByText('Velho')).toBeTruthy()
  })

  it('creates a board and opens it', async () => {
    show([])
    fireEvent.click(await screen.findByText('Novo quadro'))
    vi.mocked(api).mockResolvedValueOnce(board('b3', 'Mapa')).mockReturnValue(new Promise(() => {}))
    fireEvent.change(screen.getByPlaceholderText('Nome do quadro'), { target: { value: '  Mapa ' } })
    fireEvent.click(screen.getByText('Criar'))
    expect(await screen.findByText('Abrindo o quadro…')).toBeTruthy()
    expect(vi.mocked(api)).toHaveBeenCalledWith('/addons/whiteboard/channels/c1/boards', { method: 'POST', body: { name: 'Mapa' } })
  })

  it('only looks without EDIT_WHITEBOARD', async () => {
    show([board('b1', 'Ideias')], false)
    expect(await screen.findByText('Somente leitura')).toBeTruthy()
    expect(screen.queryByText('Novo quadro')).toBeNull()
    expect(screen.queryByLabelText('Opções do quadro')).toBeNull()
  })

  it('applies live list events, last edited first', async () => {
    show([board('b1', 'Ideias'), board('b2', 'Mapa', { updated_at: '2026-10-25T14:00:00Z' })])
    await screen.findByText('Ideias')
    useWhiteboard.getState().apply('addon.whiteboard.board.updated', {
      ...board('b2', 'Mapa novo', { updated_at: '2026-10-25T14:59:00Z' }),
      channel_id: 'c1'
    })
    expect(useWhiteboard.getState().lists.c1.boards.map((b) => b.name)).toEqual(['Mapa novo', 'Ideias'])
  })
})

describe('deleting a board', () => {
  it('is offered on my own boards, asks first and removes it', async () => {
    show([board('b1', 'Minha'), board('b2', 'Da Bia', { created_by: 'u2' })])
    await screen.findByText('Minha')
    const [mine, theirs] = screen.getAllByLabelText('Opções do quadro')
    fireEvent.click(theirs)
    expect(screen.queryByText('Excluir')).toBeNull()
    fireEvent.click(theirs)
    fireEvent.click(mine)
    fireEvent.click(screen.getByText('Excluir'))
    vi.mocked(api).mockResolvedValueOnce(undefined)
    fireEvent.click(screen.getByText('Excluir', { selector: 'button[type="button"]:not([role])' }))
    await waitFor(() => expect(screen.queryByText('Minha')).toBeNull())
    expect(vi.mocked(api)).toHaveBeenCalledWith('/addons/whiteboard/channels/c1/boards/b1', { method: 'DELETE' })
    expect(screen.getByText('Da Bia')).toBeTruthy()
  })

  it('drops a board deleted by someone else', async () => {
    show([board('b1', 'Ideias'), board('b2', 'Mapa')])
    await screen.findByText('Mapa')
    act(() => useWhiteboard.getState().apply('addon.whiteboard.board.deleted', { channel_id: 'c1', id: 'b2' }))
    expect(screen.queryByText('Mapa')).toBeNull()
  })
})

describe('editedLabel', () => {
  const people = new Map([['u1', { display_name: 'Ana' }]]) as never
  it('says who edited and when', () => {
    expect(editedLabel(board('b', 'x', { updated_at: '2026-10-25T14:59:40Z' }), people, NOW)).toBe('editado por Ana agora há pouco')
    expect(editedLabel(board('b', 'x'), people, NOW)).toBe('editado por Ana há 5 min')
    expect(editedLabel(board('b', 'x', { updated_at: '2026-10-25T12:00:00Z' }), people, NOW)).toBe('editado por Ana há 3 h')
    expect(editedLabel(board('b', 'x', { updated_at: '2026-10-24T12:00:00Z' }), people, NOW)).toBe('editado por Ana ontem')
    expect(editedLabel(board('b', 'x', { updated_at: '2026-10-18T12:00:00Z', updated_by: 'gone' }), people, NOW)).toBe(
      'editado por alguém em 18/10'
    )
  })
})
