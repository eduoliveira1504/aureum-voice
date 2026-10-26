import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type Message, type ServerDetail, type StickerPack } from '../lib/api'
import { useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { stickerMatches, useStickers } from '../store/stickers'
import { useForwardTargets } from './ForwardModal'
import { StickerPanel } from './Stickers'

vi.mock('../lib/api', async (original) => ({ ...(await original<object>()), api: vi.fn() }))
vi.mock('../lib/attachments', () => ({ useAttachmentUrl: () => ({ url: 'blob:x', failed: false }) }))

const sticker = (id: string, name: string, emoji: string | null = null) => ({ id, name, emoji, width: 320, height: 320, url: `/api/media/stickers/${id}` })
const PACKS: StickerPack[] = [
  { id: 'p-aureum', name: 'Aureum básico', is_global: true, server_id: null, stickers: [sticker('a1', 'bom dia', '☀️'), sticker('a2', 'kkkk', '😂')] },
  { id: 'p-s1', name: '', is_global: false, server_id: 's1', stickers: [sticker('s1a', 'gol')] },
  { id: 'p-s2', name: '', is_global: false, server_id: 's2', stickers: [sticker('s2a', 'parabéns')] }
]
const server = (id: string, name: string): ServerDetail =>
  ({ id, name, owner_id: 'me', icon_url: null, channels: [{ id: `${id}-c`, server_id: id, name: 'geral', type: 'text', position: 0, overrides: [] }], roles: [], members: [] }) as unknown as ServerDetail

beforeEach(() => {
  vi.mocked(api).mockReset()
  vi.mocked(api).mockResolvedValue(PACKS)
  useStickers.setState({ packs: PACKS, loaded: true })
  useChat.setState({ servers: { s1: server('s1', 'Squad'), s2: server('s2', 'Trampo') }, order: ['s1', 's2'] })
  useAppearance.setState((s) => ({ settings: { ...s.settings, recent_stickers: ['a2', 's2a'] } }))
})

describe('the Figurinhas tab', () => {
  it("shows Aureum's, this server's, and the other servers' locked", () => {
    const onPick = vi.fn()
    render(<StickerPanel serverId="s1" onPick={onPick} />)
    expect(screen.getByText('Aureum básico')).toBeTruthy()
    expect(screen.getByText('Squad')).toBeTruthy()
    const locked = screen.getByRole('button', { name: 'parabéns (Só no servidor Trampo)' })
    expect((locked as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'gol' }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 's1a' }))
    // Recent: only what goes here (kkkk, not the other server's).
    expect(screen.getAllByRole('button', { name: 'kkkk' })).toHaveLength(2)
  })

  it("a DM only takes Aureum's", () => {
    render(<StickerPanel serverId={null} onPick={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'gol (Só no servidor Squad)' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('searches by name (accents ignored) or emoji', () => {
    expect(stickerMatches(sticker('x', 'Parabéns'), 'parabens')).toBe(true)
    expect(stickerMatches(sticker('x', 'kkkk', '😂'), '😂')).toBe(true)
    expect(stickerMatches(sticker('x', 'kkkk', '😂'), 'gol')).toBe(false)
    render(<StickerPanel serverId="s1" onPick={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Buscar figurinha'), { target: { value: 'bom' } })
    expect(screen.getByRole('button', { name: 'bom dia' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'gol' })).toBeNull()
  })
})

describe('sending', () => {
  it('posts the sticker and remembers it first among the recent ones', async () => {
    const message = { id: 9, channel_id: 'c1', content: '[Figurinha: gol]', attachments: [] } as unknown as Message
    vi.mocked(api).mockResolvedValueOnce(message)
    const update = vi.spyOn(useAppearance.getState(), 'update').mockImplementation(() => {})
    await useStickers.getState().send('c1', sticker('s1a', 'gol'), { id: 3, mention: false })
    expect(api).toHaveBeenCalledWith('/channels/c1/messages', { method: 'POST', body: { sticker_id: 's1a', reply_to_id: 3, mention_reply: false } })
    expect(update).toHaveBeenCalledWith({ recent_stickers: ['s1a', 'a2', 's2a'] })
  })

  it("a server's sticker can't be forwarded out of its server", () => {
    const message = {
      id: 1,
      channel_id: 's1-c',
      attachments: [],
      sticker: { id: 's1a', name: 'gol', pack_id: 'p-s1', server_id: 's1', url: '', width: 320, height: 320 }
    } as unknown as Message
    const { result } = renderHook(() => useForwardTargets(message, 'me'))
    const byWhere = Object.fromEntries(result.current.map((t) => [t.where, t.blocked]))
    expect(byWhere.Squad).toBeUndefined()
    expect(byWhere.Trampo).toBe('Figurinha só do servidor Squad')
  })
})
