/** The chat never scrolls sideways (3.24 D): long links and words wrap instead of stretching the
 * message. jsdom has no layout, so this checks the rules that do it; the layout itself was
 * measured in Chromium (a 500-character URL in a 320 px column: no horizontal scroll). */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Channel, Me, Message } from '../lib/api'
import { useChat } from '../store/chat'
import { ChatView } from './ChatView'

const ME: Me = {
  id: 'u-me',
  username: 'eduardo',
  display_name: 'Eduardo',
  avatar_url: '/media/me.png',
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
  email: 'eduardo@example.com',
  is_app_owner: false,
  email_verified: true,
  must_change_password: false
}
const TEXT: Channel = { id: 'c-text', server_id: null, name: 'geral', type: 'text', position: 0, addon_key: null, config: {}, overrides: [] } as never

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  uploadFile: () => ({ done: new Promise(() => {}), abort: () => {} })
}))

const LONG_URL = `https://exemplo.com/${'a'.repeat(480)}`
const WORD = 'palavra'.repeat(60)

const message = (id: number, content: string, extra: Partial<Message> = {}): Message =>
  ({
    id,
    channel_id: TEXT.id,
    author: ME,
    content,
    attachments: [],
    created_at: '2026-11-08T12:00:00Z',
    edited_at: null,
    call: null,
    ...extra
  }) as Message

beforeEach(() => {
  const card = { url: LONG_URL, kind: 'link', site: 'exemplo.com', title: WORD, description: LONG_URL }
  useChat.setState({
    meId: ME.id,
    loaded: true,
    messages: {
      [TEXT.id]: {
        items: [message(1, `olha ${LONG_URL}`), message(2, WORD, { link_previews: [card] } as never)],
        hasMore: false,
        loaded: true,
        loading: false
      }
    }
  })
})

describe('chat width', () => {
  it('wraps long links and words anywhere, without cutting any text', () => {
    render(<ChatView channel={TEXT} me={ME} canModerate={false} />)
    const text = screen.getByText(WORD, { selector: 'p' })
    expect(text.className).toContain('wrap-anywhere')
    expect(text.className).not.toContain('truncate')
    expect(text.textContent).toBe(WORD)
    expect(screen.getAllByText(LONG_URL).length).toBeGreaterThan(0)
  })

  it('keeps link cards inside the column, wrapping their text', () => {
    render(<ChatView channel={TEXT} me={ME} canModerate={false} />)
    const title = screen.getAllByText(WORD).find((el) => el.tagName === 'A')!
    const card = title.closest('[class*="group/card"]') as HTMLElement
    expect(card.className).toContain('max-w-[min(432px,100%)]')
    expect(card.className).toContain('wrap-anywhere')
  })

  it("doesn't let the list scroll sideways, and the box to type wraps too", () => {
    render(<ChatView channel={TEXT} me={ME} canModerate={false} />)
    const list = document.querySelector('.overflow-y-auto') as HTMLElement
    expect(list.className).toContain('overflow-x-hidden')
    expect(screen.getByRole('textbox').className).toContain('wrap-anywhere')
  })
})
