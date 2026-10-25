/** Badges in the profile: the inventory anyone can open, and the featured ones only you pick. */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { Badge, HeldBadge, Me } from '../lib/api'
import { useBadges } from '../store/badges'
import { useNav } from '../store/nav'
import { OfficialBadge } from './ChatView'
import { ProfileEditor } from './ProfileEditor'
import { ProfileView } from './ProfileCard'

const setUser = vi.fn()
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser })
}))

const badge = (key: string, name: string, rarity: Badge['rarity'], priority: number): Badge => ({
  key,
  name,
  description: '',
  how_to_get: `Como ganhar ${name}`,
  available: true,
  rarity,
  priority,
  exclusive_beta: false,
  numbered: false,
  icon_svg: '<svg/>',
  icon_svg_small: '<svg/>'
})

const held = (key: string, featured_position: number | null = null): HeldBadge => ({ key, number: null, granted_at: '2026-10-20T12:00:00Z', featured_position })

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
  badges: [held('founder'), held('hunter'), held('builder')],
  created_at: '2026-10-19T12:00:00Z',
  email: 'mari@exemplo.com',
  is_app_owner: false,
  email_verified: true,
  must_change_password: false
}

const featured = (): string[] => within(screen.getByLabelText('Insígnias em destaque')).getAllByRole('button', { name: /^Tirar/ }).map((b) => b.getAttribute('aria-label')!)

let call: ReturnType<typeof vi.spyOn>
// The inventory reloads the catalog (GET /badges) when it opens; these are the saves.
const saves = (): unknown[][] => call.mock.calls.filter((c: unknown[]) => c[0] !== '/badges')

beforeEach(() => {
  vi.restoreAllMocks()
  setUser.mockClear()
  useNav.setState({ profileEditor: false })
  useBadges.setState({
    catalog: {
      founder: badge('founder', 'Fundador', 'mitica', 0),
      hunter: badge('hunter', 'Caçador de bugs', 'rara', 2),
      builder: badge('builder', 'Construtor', 'comum', 5),
      veteran: badge('veteran', 'Veterano', 'rara', 4)
    }
  })
  call = vi.spyOn(api, 'api').mockImplementation(async () => ME)
})

describe('the card', () => {
  it('anyone sees the whole inventory in the Insígnias tab', () => {
    const ana = { ...ME, id: 'u-2', username: 'ana' }
    render(<ProfileView user={ana} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Insígnias (3)' }))
    const cards = screen.getAllByRole('listitem').map((c) => c.getAttribute('aria-label'))
    expect(cards).toEqual(['Fundador', 'Caçador de bugs', 'Construtor', 'Veterano (não tem)'])
    expect(screen.getByText('Como ganhar Veterano')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Destacar' })).toBeNull()
  })

  it('your own card features a badge right there', async () => {
    render(<ProfileView user={ME} onClose={() => {}} />)
    fireEvent.click(screen.getByText('+1')) // the third one, past the automatic two
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Destacar' })))
    // The automatic pick stays, plus the new one.
    expect(call).toHaveBeenCalledWith('/users/me/badges/featured', { method: 'PUT', body: { keys: ['founder', 'hunter', 'builder'] } })
    expect(setUser).toHaveBeenCalled()
  })
})

describe('Editar perfil › Insígnias', () => {
  it('picks, reorders and saves the featured ones with the profile', async () => {
    render(<ProfileEditor user={ME} />)
    expect(screen.getByText(/Automático: as 2 mais raras/)).toBeTruthy()
    expect(featured()).toEqual(['Tirar Fundador do destaque', 'Tirar Caçador de bugs do destaque'])

    const inventory = screen.getAllByRole('list').at(-1)!
    fireEvent.click(within(inventory).getByRole('button', { name: 'Destacar' })) // Construtor
    expect(featured()).toEqual(['Tirar Fundador do destaque', 'Tirar Caçador de bugs do destaque', 'Tirar Construtor do destaque'])
    expect(screen.getByText('Você tem alterações não salvas.')).toBeTruthy()

    // Construtor dragged before Fundador.
    const row = screen.getByLabelText('Insígnias em destaque')
    fireEvent.dragStart(within(row).getByLabelText('Construtor'), { dataTransfer: { effectAllowed: '' } })
    fireEvent.drop(within(row).getByLabelText('Fundador'))
    fireEvent.click(screen.getByRole('button', { name: 'Tirar Caçador de bugs do destaque' }))
    expect(featured()).toEqual(['Tirar Construtor do destaque', 'Tirar Fundador do destaque'])

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' })))
    expect(saves().map((c) => c[0])).toEqual(['/users/me', '/users/me/badges/featured'])
    expect(saves()[1][1]).toEqual({ method: 'PUT', body: { keys: ['builder', 'founder'] } })
  })

  it('"Voltar ao automático" clears the choice', async () => {
    render(<ProfileEditor user={{ ...ME, badges: [held('founder', 1), held('hunter'), held('builder', 0)] }} />)
    expect(featured()).toEqual(['Tirar Construtor do destaque', 'Tirar Fundador do destaque'])
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao automático' }))
    expect(featured()).toEqual(['Tirar Fundador do destaque', 'Tirar Caçador de bugs do destaque'])
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' })))
    expect(call).toHaveBeenCalledWith('/users/me/badges/featured', { method: 'PUT', body: { keys: [] } })
  })

  it("saving without touching the badges doesn't send them", async () => {
    render(<ProfileEditor user={ME} />)
    fireEvent.change(screen.getByLabelText('Pronomes'), { target: { value: 'ela/dela' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' })))
    expect(saves().map((c) => c[0])).toEqual(['/users/me'])
  })
})

describe("@aureum's badge notice", () => {
  it('offers "Destacar no perfil" until it is featured', async () => {
    const { unmount } = render(<OfficialBadge badgeKey="builder" me={ME} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Destacar no perfil' })))
    expect(call).toHaveBeenCalledWith('/users/me/badges/featured', { method: 'PUT', body: { keys: ['founder', 'hunter', 'builder'] } })
    unmount()

    render(<OfficialBadge badgeKey="builder" me={{ ...ME, badges: [held('founder'), held('builder', 0)] }} />)
    expect(screen.getByText('Em destaque no perfil')).toBeTruthy()
  })

  it('with three featured already, opens the editor to choose', () => {
    const full = { ...ME, badges: [held('founder', 0), held('hunter', 1), held('veteran', 2), held('builder')] }
    render(<OfficialBadge badgeKey="builder" me={full} />)
    fireEvent.click(screen.getByRole('button', { name: 'Destacar no perfil' }))
    expect(useNav.getState().profileEditor).toBe(true)
    expect(saves()).toEqual([])
  })
})
