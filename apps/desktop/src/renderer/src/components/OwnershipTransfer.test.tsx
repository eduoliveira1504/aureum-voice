import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type ServerDetail } from '../lib/api'
import { ServerSettingsModal } from './ServerSettings'

vi.mock('../lib/api', async (original) => ({ ...(await original<object>()), api: vi.fn() }))

const user = (id: string, name: string, extra = {}) => ({ id, username: name, display_name: name, avatar_url: null, created_at: '', ...extra })
const server = (ownerId: string): ServerDetail =>
  ({
    id: 's1', name: 'Turma', owner_id: ownerId, channels: [], categories: [], voice_states: [], reads: [],
    roles: [{ id: 's1', name: '@everyone', position: 0, permissions: 0 }],
    members: [
      { user: user('me', 'eu'), role_ids: [] },
      { user: user('bia', 'bia'), role_ids: [] },
      { user: user('off', 'desligada', { deactivated: true }), role_ids: [] }
    ]
  }) as unknown as ServerDetail

beforeEach(() => {
  vi.mocked(api).mockReset()
  vi.mocked(api).mockResolvedValue({})
})

describe('Configurações do servidor › Membros › Passar a posse', () => {
  it('is offered by the owner, for active members only, after typing the name', async () => {
    render(<ServerSettingsModal server={server('me')} meId="me" onClose={() => {}} />)
    fireEvent.click(screen.getByText('Membros'))
    // Bia (active) and nobody else: not me, not the deactivated account.
    const buttons = screen.getAllByRole('button', { name: 'Passar a posse' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])

    const confirm = screen.getAllByRole('button', { name: 'Passar a posse' }).at(-1)!
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Digite o nome do servidor para confirmar'), { target: { value: 'Turma' } })
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(api).toHaveBeenCalledWith('/servers/s1/transfer', { method: 'POST', body: { user_id: 'bia' } }))
  })

  it('is not offered to members who are not the owner', () => {
    render(<ServerSettingsModal server={server('bia')} meId="me" onClose={() => {}} />)
    const tab = screen.queryByText('Membros')
    if (tab) fireEvent.click(tab)
    expect(screen.queryByRole('button', { name: 'Passar a posse' })).toBeNull()
  })
})
