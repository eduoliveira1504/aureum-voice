/**
 * Block 3.4: Home opens on the hub (Início), with Amigos next to it in the sidebar.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { Me, User } from '../lib/api'
import { useChat } from '../store/chat'
import { useNav } from '../store/nav'
import { useSocial } from '../store/social'
import { greeting } from './HomeHub'
import { Sidebar } from './Sidebar'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))

function person(id: string, username: string, extra: Partial<User> = {}): User {
  return {
    id,
    username,
    display_name: username[0].toUpperCase() + username.slice(1),
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
    created_at: '2026-01-01T00:00:00Z',
    ...extra
  }
}

const ME: Me = { ...person('u-me', 'edu'), email: 'edu@example.com', is_app_owner: false, email_verified: true, must_change_password: false }
const ANA = person('u-ana', 'ana')

beforeEach(() => {
  vi.spyOn(api, 'api').mockResolvedValue([])
  useChat.setState({ meId: ME.id, loaded: true, servers: {}, order: [], reads: {}, messages: {} })
  useSocial.setState({ meId: ME.id, loaded: true, friends: {}, dms: {}, presence: {}, missed: [] })
  useNav.setState({ place: 'home', homePage: 'hub' })
})

describe('greeting', () => {
  it('follows the local clock', () => {
    const at = (h: number): string => greeting(new Date(2026, 9, 21, h, 30))
    expect([at(4), at(5), at(11), at(12), at(17), at(18), at(23)]).toEqual([
      'Boa noite',
      'Bom dia',
      'Bom dia',
      'Boa tarde',
      'Boa tarde',
      'Boa noite',
      'Boa noite'
    ])
  })
})

describe('Home sidebar', () => {
  it('starts on Início and counts pending requests on Amigos', () => {
    useSocial.setState({ friends: { [ANA.id]: { user: ANA, kind: 'incoming', since: '2026-10-21T10:00:00Z', status: 'offline' } } })
    render(<Sidebar server={null} me={ME} />)
    const inicio = screen.getByRole('button', { name: 'Início' })
    const amigos = screen.getByRole('button', { name: /^Amigos/ })
    expect(inicio.getAttribute('aria-current')).toBe('page')
    expect(amigos.textContent).toContain('1')
    fireEvent.click(amigos)
    expect(useNav.getState().homePage).toBe('friends')
    fireEvent.click(screen.getByRole('button', { name: 'Início' }))
    expect(useNav.getState().homePage).toBe('hub')
  })
})
