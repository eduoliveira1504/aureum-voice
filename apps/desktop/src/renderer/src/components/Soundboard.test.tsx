import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type ServerDetail, type Sound } from '../lib/api'
import { channelPermissions, Perm } from '../lib/permissions'
import { useSoundboard } from '../store/soundboard'
import { useVoice } from '../store/voice'
import { ServerSoundsTab, SoundboardGrid } from './Soundboard'

vi.mock('../lib/api', async (original) => ({ ...(await original<object>()), api: vi.fn() }))
vi.mock('../lib/attachments', () => ({ attachmentUrl: async () => 'blob:x' }))

const sound = (id: string, name: string, extra: Partial<Sound> = {}): Sound => ({
  id, server_id: 's1', name, emoji: null, volume: 100, duration_ms: 1500, url: `/api/media/sounds/${id}`, ...extra
})
const SOUNDS = [sound('b', 'buzina', { emoji: '📯', volume: 70 }), sound('s', 'sino')]
const server = { id: 's1', name: 'Squad', owner_id: 'me', channels: [], roles: [], members: [] } as unknown as ServerDetail

beforeEach(() => {
  vi.mocked(api).mockReset()
  vi.mocked(api).mockResolvedValue(SOUNDS)
  useSoundboard.setState({ byServer: {} })
})

describe('Configurações do servidor › Painel de sons', () => {
  it("lists the server's sounds with their length", async () => {
    render(<ServerSoundsTab server={server} />)
    expect(await screen.findByText('buzina')).toBeTruthy()
    expect(api).toHaveBeenCalledWith('/servers/s1/sounds')
    expect(screen.getAllByText('1,5 s')).toHaveLength(2)
    expect(screen.getByText(/2\/24 usados/)).toBeTruthy()
  })

  it('saves a volume once the slider is let go', async () => {
    render(<ServerSoundsTab server={server} />)
    const slider = await screen.findByLabelText('Volume de buzina')
    fireEvent.change(slider, { target: { value: '40' } })
    expect(api).not.toHaveBeenCalledWith('/sounds/b', expect.anything())
    fireEvent.pointerUp(slider)
    await waitFor(() => expect(api).toHaveBeenCalledWith('/sounds/b', { method: 'PATCH', body: { volume: 40 } }))
  })

  it("reloads a server's sounds when they change elsewhere", async () => {
    useSoundboard.setState({ byServer: { s1: SOUNDS } })
    useSoundboard.getState().applyEvent({ type: 'soundboard.updated', data: { server_id: 's1' } })
    useSoundboard.getState().applyEvent({ type: 'soundboard.updated', data: { server_id: 'not-loaded' } })
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
    expect(api).toHaveBeenCalledWith('/servers/s1/sounds')
  })
})

describe('the grid in the call', () => {
  it('plays a sound on click', async () => {
    const play = vi.spyOn(useVoice.getState(), 'playBoardSound').mockResolvedValue()
    render(<SoundboardGrid serverId="s1" canManage={false} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Tocar buzina' }))
    expect(play).toHaveBeenCalledWith(SOUNDS[0])
    play.mockRestore()
  })

  it('greys out while a sound plays and during the cooldown', async () => {
    useVoice.setState({ boardSound: 'b', boardUntil: 0 })
    render(<SoundboardGrid serverId="s1" canManage={false} />)
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: 'Tocar sino' })).disabled).toBe(true)
    useVoice.setState({ boardSound: null, boardUntil: Date.now() + 3000 })
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Tocar sino' }).disabled).toBe(true))
    useVoice.setState({ boardUntil: 0 })
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Tocar sino' }).disabled).toBe(false))
  })

  it('says where to add sounds, to who can', async () => {
    vi.mocked(api).mockResolvedValue([])
    render(<SoundboardGrid serverId="s1" canManage />)
    expect(await screen.findByText(/Configurações do servidor › Painel de sons/)).toBeTruthy()
  })
})

describe('permissions', () => {
  it('a voice room without Conectar takes the sound panel away too', () => {
    const everyone = Perm.VIEW_CHANNEL | Perm.SPEAK | Perm.USE_SOUNDBOARD
    const room = { id: 'v', server_id: 's1', name: 'Sala', type: 'voice', position: 0, overrides: [] }
    const detail = { ...server, owner_id: 'other', roles: [{ id: 's1', permissions: everyone }], members: [{ user: { id: 'me' }, role_ids: [] }] }
    const perms = channelPermissions(detail as unknown as ServerDetail, room as never, 'me')
    expect(perms & Perm.USE_SOUNDBOARD).toBe(0)
    const withConnect = { ...detail, roles: [{ id: 's1', permissions: everyone | Perm.CONNECT }] }
    expect(channelPermissions(withConnect as unknown as ServerDetail, room as never, 'me') & Perm.USE_SOUNDBOARD).toBeTruthy()
  })
})
