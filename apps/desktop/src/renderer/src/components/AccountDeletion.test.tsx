import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError } from '../lib/api'
import { DeleteAccountSettings } from './AccountDeletion'
import { DeletionScheduledScreen } from './AccountScreens'

vi.mock('../lib/api', async (original) => ({ ...(await original<object>()), api: vi.fn() }))
const auth = { logout: vi.fn(async () => {}), reload: vi.fn(async () => {}) }
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => auth }))

beforeEach(() => {
  vi.mocked(api).mockReset()
  vi.mocked(api).mockResolvedValue({})
  auth.logout.mockClear()
  auth.reload.mockClear()
})

describe('Editar perfil › Conta › Desativar ou excluir conta', () => {
  it('explains both options', () => {
    render(<DeleteAccountSettings />)
    expect(screen.getByText(/entrar de novo com seu e-mail e senha/)).toBeTruthy()
    expect(screen.getByText(/desativada por 30 dias e depois é apagada/)).toBeTruthy()
  })

  it('deactivates with the password and signs out', async () => {
    render(<DeleteAccountSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Desativar conta' }))
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(auth.logout).toHaveBeenCalled())
    expect(api).toHaveBeenCalledWith('/users/me/deactivate', { method: 'POST', body: { password: 'segredo-123' } })
  })

  it('deletes with password, code and the messages choice', async () => {
    render(<DeleteAccountSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Excluir conta' }))
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
    expect(await screen.findByText('Apagar também minhas mensagens')).toBeTruthy()
    expect(api).toHaveBeenCalledWith('/users/me/deletion/code', { method: 'POST', body: { password: 'segredo-123' } })

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '482 913' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Excluir conta' }).at(-1)!)
    await waitFor(() => expect(auth.logout).toHaveBeenCalled())
    expect(api).toHaveBeenCalledWith('/users/me/deletion', {
      method: 'POST',
      body: { password: 'segredo-123', code: '482913', delete_messages: true }
    })
  })

  it('lists the servers an owner must hand over first', async () => {
    vi.mocked(api).mockRejectedValue(
      new ApiError(409, { code: 'owns_servers', message: 'x', servers: [{ id: 's1', name: 'Turma' }] })
    )
    render(<DeleteAccountSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Excluir conta' }))
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
    expect(await screen.findByText('Turma')).toBeTruthy()
    expect(screen.getByText(/Passe a posse/)).toBeTruthy()
  })
})

describe('Conta com exclusão marcada', () => {
  it('offers to cancel the deletion', async () => {
    const due = new Date(Date.now() + 10 * 86_400_000).toISOString()
    render(<DeletionScheduledScreen dueAt={due} />)
    expect(screen.getByText(/daqui a 10 dias/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar exclusão' }))
    await waitFor(() => expect(auth.reload).toHaveBeenCalled())
    expect(api).toHaveBeenCalledWith('/users/me/deletion', { method: 'DELETE' })
  })
})
