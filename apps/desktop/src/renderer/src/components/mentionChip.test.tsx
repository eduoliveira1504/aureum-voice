/** Mentions read as the same chip everywhere, as in @aureum's messages: my own messages too. */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { Channel, Me, Member, Message, ServerDetail } from '../lib/api'
import { Perm } from '../lib/permissions'
import { useChat } from '../store/chat'
import { ChatView } from './ChatView'

const ME = { id: 'me', username: 'eduardo', display_name: 'Eduardo', avatar_url: null, badges: [], email: 'e@example.com' } as unknown as Me
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))

const SID = 's-1'
const CHAT: Channel = { id: 'c-1', server_id: SID, name: 'geral', type: 'text', position: 0, category_id: null, permissions_synced: true, addon_key: null, config: {}, overrides: [] } as never
const member = (id: string, username: string): Member => ({ user: { id, username, display_name: username, avatar_url: null, badges: [] }, role_ids: [], joined_at: '2026-01-01T00:00:00Z', nickname: null }) as unknown as Member
const SERVER = {
  id: SID,
  name: 'Squad',
  owner_id: 'me',
  roles: [{ id: SID, name: '@everyone', permissions: Perm.VIEW_CHANNEL | Perm.SEND_MESSAGES | Perm.READ_HISTORY, position: 0 }],
  channels: [CHAT],
  categories: [],
  members: [member('me', 'eduardo'), member('ana', 'ana')],
  voice_states: [],
  reads: []
} as unknown as ServerDetail
const message = (author: string, content: string): Message =>
  ({ id: author === 'me' ? 1 : 2, channel_id: CHAT.id, author: { id: author, username: author === 'me' ? 'eduardo' : 'ana', display_name: author, avatar_url: null, badges: [] }, content, attachments: [], created_at: '2026-11-22T00:00:00Z', edited_at: null }) as unknown as Message

beforeEach(() => {
  vi.spyOn(api, 'api').mockResolvedValue([])
  useChat.setState({
    meId: 'me',
    loaded: true,
    servers: { [SID]: SERVER },
    messages: { [CHAT.id]: { items: [message('ana', 'oi @eduardo'), message('me', 'oi @ana')], hasMore: false, loaded: true, loading: false } }
  })
})

describe('mention chips', () => {
  it('are chips in my own messages too, not just underlined', () => {
    render(<ChatView channel={CHAT} me={ME} canModerate={false} />)
    const mine = screen.getByRole('button', { name: /@ana/ })
    const theirs = screen.getByRole('button', { name: /@eduardo/ })
    for (const chip of [mine, theirs]) {
      expect(chip.className).toContain('text-accent-text')
      expect(chip.className).not.toMatch(/(^| )underline( |$)/)
    }
    // On my accent bubble the chip goes dark to stay readable.
    expect(mine.className).toContain('bg-main/70')
    expect(theirs.className).toContain('bg-accent/15')
  })
})
