/**
 * Right-clicking a person anywhere opens the same menu (UserContextMenu), with only the items the
 * signed-in user may use; conversations in the DM list add their own items.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Channel, Dm, Me, Member, Message, ServerDetail, User } from '../lib/api'
import { Perm } from '../lib/permissions'
import { useChat } from '../store/chat'
import { useSocial } from '../store/social'
import { ChatView } from './ChatView'
import { closeContextMenu, ContextMenuHost } from './ContextMenu'
import { DmView } from './DmView'
import { openMessageLink } from './MessageActions'
import { MemberList } from './MemberList'
import { ProfileView } from './ProfileCard'
import { ServerOverview } from './ServerOverview'
import { Sidebar } from './Sidebar'

function person(id: string, username: string): User {
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
    created_at: '2026-01-01T00:00:00Z'
  }
}

const ME: Me = { ...person('u-me', 'eduardo'), email: 'eduardo@example.com', is_app_owner: false, email_verified: true, must_change_password: false }
const ANA = person('u-ana', 'ana')
const BIA = person('u-bia', 'bia')
const OWNER = person('u-owner', 'dona')
const SID = 's-1'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))

const channel = (id: string, type: Channel['type'], name: string): Channel => ({
  id,
  server_id: SID,
  name,
  type,
  position: 0,
  addon_key: null,
  config: {},
  overrides: []
})
const TEXT = channel('c-text', 'text', 'geral')
const VOICE = channel('c-voice', 'voice', 'Sala')

const member = (user: User, roleIds: string[] = []): Member => ({
  user,
  role_ids: roleIds,
  joined_at: '2026-01-01T00:00:00Z',
  nickname: null,
  voice_muted: false,
  voice_deafened: false,
  status: 'online',
  online: true
})

function server(myRoles: string[]): ServerDetail {
  return {
    id: SID,
    name: 'Squad',
    icon_url: null,
    banner_url: null,
    owner_id: OWNER.id,
    created_at: '2026-01-01T00:00:00Z',
    roles: [
      { id: 'r-mod', server_id: SID, name: 'Mods', color: null, icon_url: null, position: 1, permissions: Perm.KICK_MEMBERS, hoist: false, mentionable: false },
      { id: SID, server_id: SID, name: '@everyone', color: null, icon_url: null, position: 0, permissions: Perm.VIEW_CHANNEL | Perm.SEND_MESSAGES | Perm.CONNECT, hoist: false, mentionable: false }
    ],
    channels: [TEXT, VOICE],
    members: [member(OWNER), member(ME, myRoles), member(ANA)],
    voice_states: [{ user_id: ANA.id, channel_id: VOICE.id, muted: false, deafened: false, camera: false, screen: false }],
    reads: []
  }
}

const message = (id: number, author: User, content: string, channelId = TEXT.id): Message => ({
  id,
  channel_id: channelId,
  author,
  content,
  attachments: [],
  created_at: '2026-10-19T12:00:00Z',
  edited_at: null,
  call: null
})

const read = (channelId: string, unread = 0) => ({ channel_id: channelId, last_read_message_id: 0, unread_count: unread, mention_count: 0 })

const DM: Dm = {
  id: 'd-ana',
  type: 'dm',
  name: null,
  icon_url: null,
  members: [
    { user: ME, status: 'online' },
    { user: ANA, status: 'online' }
  ],
  last_message_id: 2,
  read: read('d-ana', 1),
  call: null,
  voice_states: []
}
const GROUP: Dm = {
  ...DM,
  id: 'd-group',
  type: 'group_dm',
  name: 'Rolê',
  members: [...DM.members, { user: BIA, status: 'offline' }],
  last_message_id: 1,
  read: read('d-group')
}

function seed(myRoles: string[] = []): void {
  useChat.setState({
    meId: ME.id,
    loaded: true,
    servers: { [SID]: server(myRoles) },
    order: [SID],
    reads: { [DM.id]: read(DM.id, 1), [GROUP.id]: read(GROUP.id) },
    messages: {
      [TEXT.id]: {
        items: [message(1, ANA, 'oi @eduardo, bora?'), message(2, ME, 'bora')],
        hasMore: false,
        loaded: true,
        loading: false
      },
      [DM.id]: { items: [], hasMore: false, loaded: true, loading: false },
      [GROUP.id]: { items: [], hasMore: false, loaded: true, loading: false }
    }
  })
  useSocial.setState({
    friends: { [ANA.id]: { user: ANA, kind: 'friend', since: '2026-01-01T00:00:00Z', status: 'online' } },
    dms: { [DM.id]: DM, [GROUP.id]: GROUP }
  })
}

function show(ui: ReactNode): void {
  render(
    <>
      <ContextMenuHost />
      {ui}
    </>
  )
}

/** Right-clicks an element and returns the menu's item labels. */
function rightClick(element: Element): string[] {
  fireEvent.contextMenu(element)
  const menu = screen.getByRole('menu')
  return [...menu.querySelectorAll('button')].map((item) => item.textContent?.trim() ?? '')
}

beforeEach(() => {
  // The open menu lives in a store, which outlives each test's DOM.
  closeContextMenu()
  seed()
})

describe('person menu everywhere', () => {
  it('opens on chat authors, my own avatar and @mentions', () => {
    show(<ChatView channel={TEXT} me={ME} canModerate={false} />)
    expect(rightClick(screen.getByRole('button', { name: 'Perfil de Ana' }))).toContain('Ver perfil')
    closeContextMenu()
    // My own messages show my avatar (on the right), with my menu.
    expect(rightClick(screen.getByRole('button', { name: 'Perfil de Eduardo' }))).toContain('Ver perfil')
    closeContextMenu()
    const mention = screen.getByRole('button', { name: '@eduardo' })
    expect(rightClick(mention)).toContain('Ver perfil')
  })

  it('opens on the member list', () => {
    show(<MemberList server={useChat.getState().servers[SID]} meId={ME.id} onClose={() => {}} />)
    expect(rightClick(screen.getByText('Ana'))).toContain('Ver perfil')
    closeContextMenu()
  })

  it('opens on the overview members block and the people in rooms', () => {
    show(<ServerOverview server={useChat.getState().servers[SID]} me={ME} />)
    const items = rightClick(screen.getAllByText('Ana')[0])
    expect(items).toContain('Ver perfil')
  })

  it('opens on people under a room in the sidebar', () => {
    show(<Sidebar server={useChat.getState().servers[SID]} me={ME} />)
    expect(rightClick(screen.getByText('Ana'))).toContain('Ver perfil')
  })

  it('opens on the profile card', () => {
    show(<ProfileView user={ANA} onClose={() => {}} />)
    expect(rightClick(screen.getByText('@ana', { exact: false }))).toContain('Ver perfil')
  })

  it('opens on the DM header and on group members', () => {
    show(<DmView dm={DM} me={ME} />)
    // In the header and in the conversation's intro.
    for (const avatar of screen.getAllByRole('button', { name: 'Perfil de Ana' })) {
      expect(rightClick(avatar)).toEqual(expect.arrayContaining(['Ver perfil']))
      closeContextMenu()
    }
    const [header] = screen.getAllByRole('button', { name: 'Perfil de Ana' })
    expect(rightClick(header)).toEqual(expect.arrayContaining(['Fechar DM', 'Ver perfil']))
  })

  it('opens on the members of a group', () => {
    show(<DmView dm={GROUP} me={ME} />)
    const list = screen.getByRole('complementary', { name: 'Membros do grupo' })
    expect(rightClick(within(list).getByText('Bia'))).toContain('Ver perfil')
  })
})

describe('items follow permissions', () => {
  const kickAna = (): string[] => {
    show(<MemberList server={useChat.getState().servers[SID]} meId={ME.id} onClose={() => {}} />)
    return rightClick(screen.getByText('Ana'))
  }

  it('a plain member gets no moderation', () => {
    expect(kickAna()).not.toContain('Expulsar Ana')
  })

  it('a role with Kick members can kick, but not ban', () => {
    seed(['r-mod'])
    const items = kickAna()
    expect(items).toContain('Expulsar Ana')
    expect(items).not.toContain('Banir Ana')
  })

  it('nobody moderates the owner', () => {
    seed(['r-mod'])
    show(<MemberList server={useChat.getState().servers[SID]} meId={ME.id} onClose={() => {}} />)
    expect(rightClick(screen.getByText('Dona'))).not.toContain('Expulsar Dona')
  })
})

describe('conversations in the DM list', () => {
  it('a 1:1 adds read, silence and close to the person menu', () => {
    show(<Sidebar server={null} me={ME} />)
    const items = rightClick(screen.getByText('Ana'))
    expect(items).toEqual(expect.arrayContaining(['Marcar como lida', 'Silenciar conversa', 'Fechar DM', 'Ver perfil']))
  })

  it('a group has its own items', () => {
    show(<Sidebar server={null} me={ME} />)
    const items = rightClick(screen.getByText('Rolê'))
    expect(items).toEqual(expect.arrayContaining(['Silenciar conversa', 'Renomear grupo', 'Alterar ícone', 'Sair do grupo']))
    expect(items).not.toContain('Ver perfil')
    // Nothing unread there.
    expect(items).not.toContain('Marcar como lida')
  })
})

describe('message actions', () => {
  const rowOf = (id: number): HTMLElement => document.querySelector(`[data-message-id="${id}"] [tabindex="-1"]`) as HTMLElement

  it("offers copy, link and unread on someone else's message, but not edit or delete", () => {
    show(<ChatView channel={TEXT} me={ME} canModerate={false} />)
    const items = rightClick(screen.getByText('bora?', { exact: false }))
    expect(items).toEqual(expect.arrayContaining(['Copiar texto', 'Copiar link da mensagem', 'Marcar como não lida']))
    expect(items.join()).not.toMatch(/Editar|Apagar/)
  })

  it('lets me edit and delete my own, and a moderator delete anyone', () => {
    show(<ChatView channel={TEXT} me={ME} canModerate={false} />)
    expect(rightClick(screen.getByText('bora'))).toEqual(expect.arrayContaining(['EditarE', 'ApagarDel']))
    closeContextMenu()
    expect(rightClick(screen.getByText('bora?', { exact: false })).join()).not.toContain('Apagar')
  })

  it('shows the same menu from the bar\'s "…"', () => {
    show(<ChatView channel={TEXT} me={ME} canModerate />)
    const bar = within(rowOf(1)).getByRole('toolbar', { hidden: true })
    fireEvent.click(within(bar).getByLabelText('Mais opções'))
    const items = [...screen.getByRole('menu').querySelectorAll('button')].map((b) => b.textContent)
    expect(items).toContain('ApagarDel')
  })

  it('edits with E and asks before deleting with Del', () => {
    show(<ChatView channel={TEXT} me={ME} canModerate={false} />)
    const mine = rowOf(2)
    fireEvent.keyDown(mine, { key: 'Delete' })
    expect(screen.getByText('Excluir mensagem')).toBeTruthy()
    fireEvent.click(screen.getByText('Cancelar'))
    fireEvent.keyDown(mine, { key: 'e' })
    expect((screen.getByDisplayValue('bora') as HTMLTextAreaElement).tagName).toBe('TEXTAREA')
    // Not on someone else's message.
    fireEvent.keyDown(rowOf(1), { key: 'Delete' })
    expect(screen.queryByText('Excluir mensagem')).toBeNull()
  })

  it('turns a copied message link into a way to open it', () => {
    const elsewhere = '0b7f3c52-5f1e-4c47-9d55-3d6c1c2a9e10'
    useChat.setState((s) => ({
      messages: { ...s.messages, [TEXT.id]: { ...s.messages[TEXT.id], items: [message(3, ANA, `olha aureum://mensagem/${elsewhere}/1`)] } }
    }))
    show(<ChatView channel={TEXT} me={ME} canModerate={false} />)
    // A channel the user can't see: no name, and opening it says so.
    fireEvent.click(screen.getByRole('button', { name: 'Mensagem' }))
    expect(screen.getByRole('status').textContent).toBe('Você não tem acesso a essa mensagem.')
    expect(useChat.getState().focus).toBeNull()
    openMessageLink(TEXT.id, 1)
    expect(useChat.getState().focus).toEqual({ channelId: TEXT.id, messageId: 1 })
  })
})
