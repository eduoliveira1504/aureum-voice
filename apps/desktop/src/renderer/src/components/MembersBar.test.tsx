/** One member bar per server: the panels no longer carry their own, and it's saved per server. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Channel, Me, Member, PanelLayout, ServerDetail, User } from '../lib/api'
import { Perm } from '../lib/permissions'
import { useAppearance } from '../store/appearance'
import { membersBarOpen, useNav } from '../store/nav'
import { MembersBar } from './MemberList'
import { Panels } from './Panels'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedOut' }, logout: async () => {}, setUser: () => {} })
}))
vi.mock('./ChatView', () => ({ ChatView: () => <div>chat</div> }))
vi.mock('./ServerOverview', () => ({ ServerOverview: () => <div>overview</div> }))
vi.mock('./VoiceView', () => ({ VoiceView: () => <div>voice</div> }))

const SID = 's-1'
const OTHER = 's-2'

function person(id: string, username: string): User {
  return {
    id,
    username,
    display_name: username,
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
    created_at: '2026-01-01T00:00:00Z'
  }
}

const ME: Me = { ...person('u-me', 'eu'), email: 'eu@example.com', is_app_owner: false, email_verified: true, must_change_password: false }

const member = (user: User): Member => ({
  user,
  role_ids: [],
  joined_at: '2026-01-01T00:00:00Z',
  nickname: null,
  voice_muted: false,
  voice_deafened: false,
  status: 'online',
  online: true
})

const channel = (id: string, name: string): Channel => ({
  id,
  server_id: SID,
  name,
  type: 'text',
  position: 0,
  addon_key: null,
  config: {},
  overrides: []
})

const SERVER: ServerDetail = {
  id: SID,
  name: 'Squad',
  icon_url: null,
  banner_url: null,
  owner_id: ME.id,
  created_at: '2026-01-01T00:00:00Z',
  roles: [
    { id: SID, server_id: SID, name: '@everyone', color: null, icon_url: null, position: 0, permissions: Perm.VIEW_CHANNEL, hoist: false, mentionable: false }
  ],
  channels: [channel('c-1', 'geral'), channel('c-2', 'jogos')],
  members: [member(ME), member(person('u-ana', 'ana'))],
  voice_states: [],
  reads: []
}

const TWO_PANELS: PanelLayout = {
  panels: [
    { tabs: ['overview', 'channel:c-1'], active: 'channel:c-1' },
    { tabs: ['channel:c-2'], active: 'channel:c-2' }
  ],
  split: 0.5
}

const layout = (id = SID): PanelLayout | undefined => useAppearance.getState().settings.panel_layouts[id]
const setLayouts = (panel_layouts: Record<string, PanelLayout>, column_sizes: Record<string, number> = {}): void =>
  useAppearance.setState((s) => ({ settings: { ...s.settings, panel_layouts, column_sizes } }))

const shortcut = (): void => void fireEvent.keyDown(window, { key: 'U', ctrlKey: true, shiftKey: true })
const bar = (): HTMLElement | null => screen.queryByRole('complementary', { name: 'Membros' })

beforeEach(() => {
  setLayouts({})
  useNav.setState({ place: SID, focusedPanel: {}, narrow: false })
})

describe('saved state', () => {
  it('opens for a layout saved with the old per-tab list', () => {
    expect(membersBarOpen(undefined)).toBe(false)
    expect(membersBarOpen(TWO_PANELS)).toBe(false)
    expect(membersBarOpen({ ...TWO_PANELS, members: ['channel:c-1'] })).toBe(true)
  })

  it('a choice wins over the old list, and stays through tab changes', () => {
    setLayouts({ [SID]: { ...TWO_PANELS, members: ['channel:c-1'] } })
    useNav.getState().toggleMembers(SID)
    expect(membersBarOpen(layout())).toBe(false)
    useNav.getState().closeTab(SID, 0, 'channel:c-1')
    expect(membersBarOpen(layout())).toBe(false)
    useNav.getState().toggleMembers(SID)
    useNav.getState().closeTab(SID, 1, 'channel:c-2')
    expect(membersBarOpen(layout())).toBe(true)
  })

  it('keeps state and width per server', () => {
    useNav.getState().toggleMembers(SID)
    useNav.getState().setMembersWidth(SID, 320)
    expect(layout()).toMatchObject({ members_open: true, members_width: 320 })
    expect(layout(OTHER)).toBeUndefined()
  })
})

describe('MembersBar', () => {
  it('toggles with Ctrl+Shift+U, only for the plain combination', () => {
    render(<MembersBar server={SERVER} meId={ME.id} />)
    expect(bar()).toBeNull()
    fireEvent.keyDown(window, { key: 'u', ctrlKey: true })
    expect(bar()).toBeNull()
    act(shortcut)
    expect(bar()).not.toBeNull()
    act(shortcut)
    expect(bar()).toBeNull()
  })

  it('leaves the shortcut to an open modal', () => {
    render(
      <>
        <div aria-modal="true" />
        <MembersBar server={SERVER} meId={ME.id} />
      </>
    )
    act(shortcut)
    expect(bar()).toBeNull()
  })

  it('uses the server width, then the general one', () => {
    setLayouts({ [SID]: { ...TWO_PANELS, members_open: true } }, { members: 280 })
    const { rerender } = render(<MembersBar server={SERVER} meId={ME.id} />)
    expect(bar()!.style.width).toBe('280px')
    act(() => setLayouts({ [SID]: { ...TWO_PANELS, members_open: true, members_width: 340 } }, { members: 280 }))
    rerender(<MembersBar server={SERVER} meId={ME.id} />)
    expect(bar()!.style.width).toBe('340px')
  })
})

describe('Panels', () => {
  it('has no members button of its own', () => {
    setLayouts({ [SID]: TWO_PANELS })
    render(<Panels server={SERVER} me={ME} />)
    expect(screen.getByRole('region', { name: 'Painel 2' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Membros' })).toBeNull()
  })
})
