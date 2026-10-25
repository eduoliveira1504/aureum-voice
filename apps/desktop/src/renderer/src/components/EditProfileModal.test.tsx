/** "Editar perfil" opens from your own card, and nobody loses changes by closing it by mistake. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Me } from '../lib/api'
import { useNav } from '../store/nav'
import { EditProfileHost } from './EditProfileModal'
import { ProfileView } from './ProfileCard'
import { SettingsModal } from './SettingsModal'

const ME: Me = {
  id: 'u-1',
  username: 'mari',
  display_name: 'Mari',
  avatar_url: null,
  banner_url: null,
  bio: null,
  accent_color: null,
  pronouns: null,
  custom_status: null,
  avatar_frame: 'none',
  favorite_song: null,
  links: [],
  badges: [],
  created_at: '2026-10-19T12:00:00Z',
  email: 'mari@exemplo.com',
  is_app_owner: false,
  email_verified: true,
  must_change_password: false
}

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))

const editor = (): HTMLElement | null => screen.queryByRole('dialog', { name: 'Editar perfil' })

beforeEach(() => useNav.setState({ profileEditor: false }))

describe('Editar perfil', () => {
  it('opens from your own profile card, and only from yours', () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <>
        <ProfileView user={ME} onClose={onClose} />
        <EditProfileHost me={ME} />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Editar perfil' }))
    expect(onClose).toHaveBeenCalled()
    expect(editor()).toBeTruthy()
    // The editor's own preview card has no button.
    expect(screen.getAllByRole('button', { name: 'Editar perfil' })).toHaveLength(1)
    unmount()

    render(<ProfileView user={{ ...ME, id: 'u-2', username: 'ana' }} onClose={onClose} />)
    expect(screen.queryByRole('button', { name: 'Editar perfil' })).toBeNull()
  })

  it('closes right away without changes', () => {
    useNav.setState({ profileEditor: true })
    render(<EditProfileHost me={ME} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(editor()).toBeNull()
  })

  it('asks before throwing changes away', async () => {
    useNav.setState({ profileEditor: true })
    render(<EditProfileHost me={ME} />)
    fireEvent.change(screen.getByLabelText('Pronomes'), { target: { value: 'ela/dela' } })
    expect(screen.getByText('Você tem alterações não salvas.')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Descartar alterações?' })).toBeTruthy()
    // Escape on the question only closes the question.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Descartar alterações?' })).toBeNull()
    expect((screen.getByLabelText('Pronomes') as HTMLInputElement).value).toBe('ela/dela')

    fireEvent.keyDown(window, { key: 'Escape' })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Descartar' })))
    expect(editor()).toBeNull()
  })

  it('"Desfazer" puts the profile back as it was', () => {
    useNav.setState({ profileEditor: true })
    render(<EditProfileHost me={ME} />)
    fireEvent.change(screen.getByLabelText('Pronomes'), { target: { value: 'ela/dela' } })
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    expect((screen.getByLabelText('Pronomes') as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('Você tem alterações não salvas.')).toBeNull()
  })

  it('Configurações › Meu perfil is the same editor and asks before leaving the tab', () => {
    render(<SettingsModal onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Pronomes'), { target: { value: 'ela/dela' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Aparência' }))
    expect(screen.getByRole('dialog', { name: 'Descartar alterações?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect((screen.getByLabelText('Pronomes') as HTMLInputElement).value).toBe('ela/dela')
  })
})
