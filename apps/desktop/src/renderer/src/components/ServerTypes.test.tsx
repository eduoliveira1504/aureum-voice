import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, serverAllows, type AddonInfo, type ServerDetail, type ServerTypeInfo } from '../lib/api'
import { useChat } from '../store/chat'
import { AddServerModal, CreateAddonModal } from './modals'
import { ServerSettingsModal } from './ServerSettings'

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

describe('addons and sounds follow the type', () => {
  const addon = (key: string, name: string): AddonInfo => ({
    key, name, description: '', icon: 'box', permissions: { view: 1 }, config_schema: null, announces: false
  })
  const ADDONS = [addon('kanban', 'Kanban'), addon('whiteboard', 'Quadro branco'), addon('calendar', 'Calendário'), addon('events', 'Eventos')]
  const server = (type: 'game' | 'work'): ServerDetail =>
    ({
      id: 's1', name: 'Squad', owner_id: 'me', type, addons: TYPES.find((t) => t.type === type)!.addons,
      channels: [], categories: [], roles: [{ id: 's1', name: '@everyone', position: 0, permissions: 0 }], members: [], voice_states: [], reads: []
    }) as unknown as ServerDetail

  it('lists only the addons the type allows', async () => {
    vi.mocked(api).mockResolvedValue(ADDONS)
    useChat.setState({ servers: { s1: server('game') }, meId: 'me' })
    render(<CreateAddonModal serverId="s1" onClose={() => {}} />)
    expect(await screen.findByText('Calendário')).toBeTruthy()
    expect(screen.getByText('Eventos')).toBeTruthy()
    expect(screen.queryByText('Kanban')).toBeNull()
    expect(screen.queryByText('Quadro branco')).toBeNull()
  })

  it('hides the sound panel tab on work servers', () => {
    vi.mocked(api).mockResolvedValue([])
    const { unmount } = render(<ServerSettingsModal server={server('game')} meId="me" onClose={() => {}} />)
    expect(screen.getByText('Painel de sons')).toBeTruthy()
    unmount()
    render(<ServerSettingsModal server={server('work')} meId="me" onClose={() => {}} />)
    expect(screen.queryByText('Painel de sons')).toBeNull()
  })
})
