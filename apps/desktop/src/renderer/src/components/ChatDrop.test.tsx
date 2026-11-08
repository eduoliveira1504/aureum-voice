/** "Solte para anexar" takes files from outside the app only, never the app's own pictures. */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Channel, Me } from '../lib/api'
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

beforeEach(() => {
  useChat.setState({
    meId: ME.id,
    loaded: true,
    messages: { [TEXT.id]: { items: [], hasMore: false, loaded: true, loading: false } }
  })
})

const filesDrag = (file: File): { dataTransfer: Partial<DataTransfer> } => ({
  dataTransfer: { types: ['Files'], files: [file] as unknown as FileList, dropEffect: 'none' }
})

describe('dropping on the chat', () => {
  it('attaches a file brought in from outside the app', () => {
    render(<ChatView channel={TEXT} me={ME} canModerate={false} />)
    const chat = screen.getByRole('textbox').closest('.bg-main') as HTMLElement
    const file = new File(['oi'], 'notas.txt', { type: 'text/plain' })
    fireEvent.dragOver(chat, filesDrag(file))
    expect(screen.getByText('Solte para anexar')).toBeTruthy()
    fireEvent.drop(chat, filesDrag(file))
    expect(screen.getByText('notas.txt')).toBeTruthy()
  })

  it("ignores a picture dragged from the app itself, even though it carries a file", () => {
    render(
      <>
        <img src="/media/ana.png" alt="Ana" />
        <ChatView channel={TEXT} me={ME} canModerate={false} />
      </>
    )
    const chat = screen.getByRole('textbox').closest('.bg-main') as HTMLElement
    const picture = new File(['png'], 'ana.png', { type: 'image/png' })
    fireEvent.dragStart(screen.getByAltText('Ana'))
    const over = fireEvent.dragOver(chat, filesDrag(picture))
    expect(over).toBe(true) // not accepted: the drop isn't allowed here
    expect(screen.queryByText('Solte para anexar')).toBeNull()
    fireEvent.drop(chat, filesDrag(picture))
    fireEvent.dragEnd(screen.getByAltText('Ana'))
    expect(screen.queryByText('ana.png')).toBeNull()

    // Once that drag is over, files from outside attach again.
    const file = new File(['oi'], 'notas.txt', { type: 'text/plain' })
    fireEvent.drop(chat, filesDrag(file))
    expect(screen.getByText('notas.txt')).toBeTruthy()
  })
})
