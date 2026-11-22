/** Configurações in six groups instead of thirteen tabs (Eduardo, 22/11). */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Me } from '../lib/api'
import { groupOf, SettingsModal } from './SettingsModal'

const ME = { id: 'me', username: 'me', display_name: 'Eu', avatar_url: null, badges: [], email: 'me@example.com', is_app_owner: false } as unknown as Me
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))

describe('Configurações', () => {
  it('has six groups in a column, each with its sections', () => {
    render(<SettingsModal onClose={() => {}} />)
    const groups = screen.getAllByRole('button').filter((b) => b.closest('nav')).map((b) => b.textContent)
    expect(groups).toEqual(['Conta e privacidade', 'Aparência e idioma', 'Voz, vídeo e sons', 'Notificações', 'Jogos', 'Sistema', 'Sair da conta'])
    fireEvent.click(screen.getByRole('button', { name: 'Aparência e idioma' }))
    expect(screen.getByRole('region', { name: 'Aparência' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Idioma' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Convites' })).toBeNull()
  })

  it('opened on an old tab, lands in its group', () => {
    render(<SettingsModal initialTab="sounds" onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Voz, vídeo e sons', current: 'page' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Sons' })).toBeTruthy()
    expect(groupOf('tips')).toBe('notifications')
    expect(groupOf('overlay')).toBe('games')
  })

  it('the problem reports stay with the app owner', () => {
    render(<SettingsModal initialTab="about" onClose={() => {}} />)
    expect(screen.getByRole('region', { name: 'Sobre' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Problemas' })).toBeNull()
  })
})
