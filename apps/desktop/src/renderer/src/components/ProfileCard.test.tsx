/** The profile card stays on screen; its top stays put while the badge list scrolls inside it. */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { Badge, HeldBadge, Me } from '../lib/api'
import { useBadges } from '../store/badges'
import { ProfilePopover } from './ProfileCard'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))

const KEYS = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9']

const badge = (key: string, priority: number): Badge => ({
  key,
  name: `Insígnia ${key}`,
  description: '',
  how_to_get: null,
  available: true,
  rarity: 'comum',
  priority,
  exclusive_beta: false,
  numbered: false,
  icon_svg: '<svg/>',
  icon_svg_small: '<svg/>'
})

const held = (key: string): HeldBadge => ({ key, number: null, granted_at: '2026-10-20T12:00:00Z', featured_position: null })

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
  badges: KEYS.map(held),
  created_at: '2026-10-19T12:00:00Z',
  email: 'mari@exemplo.com',
  is_app_owner: false,
  email_verified: true,
  must_change_password: false
}

const open = (): void => {
  render(<ProfilePopover user={ME} anchor={new DOMRect(100, 700, 40, 20)} onClose={() => {}} />)
}

beforeEach(() => {
  vi.restoreAllMocks()
  useBadges.setState({ catalog: Object.fromEntries(KEYS.map((key, i) => [key, badge(key, i)])) })
  vi.spyOn(api, 'api').mockImplementation(async () => ME)
})

describe('the card near the bottom of the window', () => {
  it('reaches the last badge by scrolling inside the card, under a top that stays', () => {
    open()
    fireEvent.click(screen.getByRole('tab', { name: 'Insígnias (9)' }))
    const body = screen.getByTestId('profile-card-body')
    expect(body.className).toContain('overflow-y-auto')
    expect(within(body).getAllByRole('listitem')).toHaveLength(9)
    expect(within(body).getByLabelText('Insígnia b9')).toBeTruthy()
    expect(within(body).queryByRole('tab')).toBeNull()
    expect(within(body).queryByText('Mari')).toBeNull()
  })

  it('is never taller than the window', () => {
    open()
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('max-h-[calc(100vh-16px)]')
    expect(dialog.className).not.toContain('overflow-y-auto')
  })
})
