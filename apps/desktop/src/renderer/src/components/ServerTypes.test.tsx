import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, serverAllows, type ServerTypeInfo } from '../lib/api'
import { AddServerModal } from './modals'

vi.mock('../lib/api', async (original) => ({ ...(await original<object>()), api: vi.fn() }))

const TYPES: ServerTypeInfo[] = [
  { type: 'game', name: 'Jogo', description: 'Pra jogar junto.', addons: ['calendar', 'events', 'polls', 'soundboard'] },
  { type: 'work', name: 'Trabalho', description: 'Pra times.', addons: ['calendar', 'events', 'kanban', 'polls', 'whiteboard'] },
  { type: 'mixed', name: 'Misto', description: 'Tudo junto.', addons: ['calendar', 'events', 'kanban', 'polls', 'soundboard', 'whiteboard'] }
]
const created = { id: 's1', name: 'Turma', channels: [], roles: [], members: [], voice_states: [], reads: [] }

beforeEach(() => {
  vi.mocked(api).mockReset()
  vi.mocked(api).mockImplementation(async (path: string) => (path === '/server-types' ? TYPES : created))
})

describe('Criar servidor › tipo', () => {
  it('shows the three types, the lock warning and the neutral placeholder', async () => {
    render(<AddServerModal onClose={() => {}} />)
    expect(await screen.findByText('Jogo')).toBeTruthy()
    expect(screen.getByText('Trabalho')).toBeTruthy()
    expect(screen.getByText('Misto')).toBeTruthy()
    expect(screen.getByText('O tipo não pode ser alterado depois.')).toBeTruthy()
    expect(screen.getByPlaceholderText('(Nome do servidor)')).toBeTruthy()
    expect(document.body.textContent).not.toContain('Os Brabos')
  })

  it('asks for a type before creating, then sends it', async () => {
    render(<AddServerModal onClose={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('(Nome do servidor)'), { target: { value: 'Turma' } })
    await screen.findByText('Trabalho')
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }))
    expect(await screen.findByText('Escolha o tipo do servidor.')).toBeTruthy()
    expect(api).not.toHaveBeenCalledWith('/servers', expect.anything())

    fireEvent.click(screen.getByLabelText(/Trabalho/))
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }))
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/servers', { method: 'POST', body: { name: 'Turma', type: 'work' } })
    )
  })

  it('creates without a type when the API is too old to have them', async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/server-types') throw new Error('404')
      return created
    })
    render(<AddServerModal onClose={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('(Nome do servidor)'), { target: { value: 'Turma' } })
    await waitFor(() => expect(api).toHaveBeenCalledWith('/server-types'))
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/servers', { method: 'POST', body: { name: 'Turma' } }))
    expect(screen.queryByText('O tipo não pode ser alterado depois.')).toBeNull()
  })
})

describe('serverAllows', () => {
  it("follows the server's list, and allows everything when an older API sent none", () => {
    expect(serverAllows({ addons: ['kanban'] }, 'kanban')).toBe(true)
    expect(serverAllows({ addons: ['kanban'] }, 'soundboard')).toBe(false)
    expect(serverAllows({}, 'soundboard')).toBe(true)
    expect(serverAllows(undefined, 'kanban')).toBe(true)
  })
})
