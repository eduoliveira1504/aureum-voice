/** One member bar per server: the panels no longer carry their own, and it's saved per server. */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Channel, Me, Member, PanelLayout, ServerDetail, User } from '../lib/api'
import { channelMembers, Perm } from '../lib/permissions'
import { useAppearance } from '../store/appearance'
import { membersBarOpen, useNav } from '../store/nav'
import { useVoice } from '../store/voice'
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

const ANA = person('u-ana', 'ana')
const BIA = person('u-bia', 'bia')

const member = (user: User, role_ids: string[] = []): Member => ({
  user,
  role_ids,
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

const deny = (target_id: string, bits: number, target_type: 'role' | 'member' = 'role') => ({ target_type, target_id, allow: 0, deny: bits })
const allow = (target_id: string, bits: number, target_type: 'role' | 'member' = 'role') => ({ target_type, target_id, allow: bits, deny: 0 })

/** Hidden from @everyone; the Mods role and Bia get in. */
const PRIVATE: Channel = {
  ...channel('c-3', 'staff'),
  overrides: [deny(SID, Perm.VIEW_CHANNEL), allow('r-mod', Perm.VIEW_CHANNEL), allow(BIA.id, Perm.VIEW_CHANNEL, 'member')]
}
/** Open to everyone, except one person. */
const NOT_ANA: Channel = { ...channel('c-4', 'sem-ana'), overrides: [deny(ANA.id, Perm.VIEW_CHANNEL, 'member')] }
const PRIVATE_ROOM: Channel = { ...channel('c-5', 'Reunião'), type: 'voice', overrides: PRIVATE.overrides }

const SERVER: ServerDetail = {
  id: SID,
  name: 'Squad',
  icon_url: null,
  banner_url: null,
  owner_id: ME.id,
  created_at: '2026-01-01T00:00:00Z',
  roles: [
    { id: 'r-mod', server_id: SID, name: 'Mods', color: null, icon_url: null, position: 1, permissions: 0, hoist: false, mentionable: false },
    { id: SID, server_id: SID, name: '@everyone', color: null, icon_url: null, position: 0, permissions: Perm.VIEW_CHANNEL, hoist: false, mentionable: false }
  ],
  channels: [channel('c-1', 'geral'), channel('c-2', 'jogos'), PRIVATE, NOT_ANA, PRIVATE_ROOM],
  members: [member(ME), member(ANA), member(BIA), member(person('u-mod', 'marcos'), ['r-mod'])],
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
  useNav.setState({ place: SID, focusedPanel: {}, narrow: false, membersDrawer: null })
  useVoice.setState({ phase: 'idle', serverId: null, channelId: null })
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

  it('toggles with Cmd+Shift+U on the Mac, not with Ctrl', () => {
    window.aureum.platform = 'darwin'
    try {
      render(<MembersBar server={SERVER} meId={ME.id} />)
      act(shortcut)
      expect(bar()).toBeNull()
      act(() => void fireEvent.keyDown(window, { key: 'U', metaKey: true, shiftKey: true }))
      expect(bar()).not.toBeNull()
    } finally {
      window.aureum.platform = 'win32'
    }
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

describe('drawer in a narrow window', () => {
  const drawerBar = (extra?: ReactNode) =>
    render(
      <>
        <main>conteúdo</main>
        <button type="button" data-members-toggle>
          botão
        </button>
        {extra}
        <MembersBar server={SERVER} meId={ME.id} />
      </>
    )
  const open = (): void => act(() => useNav.getState().toggleMembers(SID))

  beforeEach(() => act(() => useNav.getState().setNarrow(true)))

  it('starts closed even when the bar is saved open, and keeps that state', () => {
    setLayouts({ [SID]: { ...TWO_PANELS, members_open: true } })
    drawerBar()
    expect(bar()).toBeNull()
    open()
    expect(bar()).not.toBeNull()
    open()
    expect(bar()).toBeNull()
    expect(layout()?.members_open).toBe(true)
  })

  it('does not change the saved state, and closes when the window widens', () => {
    drawerBar()
    open()
    expect(layout()).toBeUndefined()
    act(() => useNav.getState().setNarrow(false))
    expect(bar()).toBeNull()
    expect(useNav.getState().membersDrawer).toBeNull()
  })

  it('closes with Esc', () => {
    drawerBar()
    open()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(bar()).toBeNull()
  })

  it('closes with a click outside, but not inside or on its button', () => {
    drawerBar()
    open()
    fireEvent.mouseDown(bar()!)
    expect(bar()).not.toBeNull()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'botão' }))
    expect(bar()).not.toBeNull()
    fireEvent.mouseDown(screen.getByText('conteúdo'))
    expect(bar()).toBeNull()
  })

  it('leaves Esc and clicks to a menu over it', () => {
    drawerBar(<div role="menu">menu</div>)
    open()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.mouseDown(screen.getByText('menu'))
    expect(bar()).not.toBeNull()
  })

  it('is per server', () => {
    drawerBar()
    open()
    expect(useNav.getState().membersDrawer).toBe(SID)
    render(<MembersBar server={{ ...SERVER, id: OTHER }} meId={ME.id} />)
    expect(screen.getAllByRole('complementary', { name: 'Membros' })).toHaveLength(1)
  })
})

describe('following the panel in focus', () => {
  const FOCUS: PanelLayout = {
    panels: [
      { tabs: ['overview', 'channel:c-1', 'channel:c-5', 'call'], active: 'overview' },
      { tabs: ['channel:c-3', 'channel:c-4'], active: 'channel:c-3' }
    ],
    split: 0.5,
    members_open: true
  }
  const shown = (): string[] =>
    within(bar()!)
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((t) => t !== '')
  const heading = (): string => within(bar()!).getByRole('heading', { level: 2 }).textContent ?? ''

  it('lists only who can see the channel, by role, by person and the owner', () => {
    expect(channelMembers(SERVER, PRIVATE).map((m) => m.user.username).sort()).toEqual(['bia', 'eu', 'marcos'])
    expect(channelMembers(SERVER, NOT_ANA).map((m) => m.user.username).sort()).toEqual(['bia', 'eu', 'marcos'])
    expect(channelMembers(SERVER, SERVER.channels[0])).toHaveLength(4)
  })

  it('changes with the focus, right away', () => {
    setLayouts({ [SID]: FOCUS })
    render(<MembersBar server={SERVER} meId={ME.id} />)
    // The overview shows the whole server, untitled.
    expect(heading()).toBe('Membros')
    expect(shown()).toHaveLength(4)

    act(() => useNav.getState().focusPanel(SID, 1))
    expect(heading()).toBe('Membros · #staff')
    expect(shown().some((t) => t.includes('ana'))).toBe(false)

    act(() => useNav.getState().focusPanel(SID, 0))
    expect(heading()).toBe('Membros')
    expect(shown().some((t) => t.includes('ana'))).toBe(true)
  })

  it('names a channel that hides someone, and not an open one', () => {
    setLayouts({ [SID]: FOCUS })
    render(<MembersBar server={SERVER} meId={ME.id} />)
    act(() => useNav.getState().activateTab(SID, 1, 'channel:c-4'))
    expect(heading()).toBe('Membros · #sem-ana')
    act(() => useNav.getState().activateTab(SID, 0, 'channel:c-1'))
    expect(heading()).toBe('Membros')
    expect(shown()).toHaveLength(4)
  })

  it('treats the call tab as its room, without the # of a text channel', () => {
    useVoice.setState({ phase: 'connected', serverId: SID, channelId: PRIVATE_ROOM.id } as never)
    setLayouts({ [SID]: FOCUS })
    render(<MembersBar server={SERVER} meId={ME.id} />)
    act(() => useNav.getState().activateTab(SID, 0, 'call'))
    expect(heading()).toBe('Membros · Reunião')
    expect(shown()).toHaveLength(3)
  })

  it('shows the whole server on a call tab with no call', () => {
    setLayouts({ [SID]: FOCUS })
    render(<MembersBar server={SERVER} meId={ME.id} />)
    act(() => useNav.getState().activateTab(SID, 0, 'call'))
    expect(heading()).toBe('Membros')
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
