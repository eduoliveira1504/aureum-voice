/** Block 4.1.2: one account on two devices. The device in the call keeps it; the other one says
 * so and can bring the call over; a room's list survives a server reload. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { Channel, ServerDetail, VoiceState } from '../lib/api'
import { DEVICE_ID } from '../lib/realtime'
import { useChat } from '../store/chat'
import { useSocial } from '../store/social'
import { useVoice } from '../store/voice'
import { CallCard } from './CallCard'

const ME = 'me'
const room: Channel = { id: 'v-1', server_id: 's-1', name: 'Sala geral', type: 'voice', position: 0, addon_key: null, config: {}, overrides: [] } as unknown as Channel
const inRoom = (userId: string): VoiceState => ({ user_id: userId, channel_id: 'v-1', muted: false, deafened: false, camera: false, screen: false, joined_at: null })
const server = (voice: VoiceState[]): ServerDetail =>
  ({ id: 's-1', name: 'Squad', icon_url: null, banner_url: null, owner_id: ME, created_at: '', roles: [], channels: [room], members: [], voice_states: voice, reads: [] }) as unknown as ServerDetail

const handOff = vi.fn()
const join = vi.fn(async () => {})

beforeEach(() => {
  useChat.setState({ meId: ME, loaded: true, servers: { 's-1': server([inRoom(ME), inRoom('ana')]) }, order: ['s-1'] })
  useSocial.setState({ meId: ME, dms: {} })
  useVoice.setState({ phase: 'idle', serverId: null, channelId: null, handOff, join })
  handOff.mockClear()
  join.mockClear()
})
afterEach(() => vi.restoreAllMocks())

describe('in a call on another device', () => {
  it('says so where the call card goes, with "Entrar por aqui"', () => {
    render(<CallCard collapsed={false} meId={ME} />)
    expect(screen.getByRole('region', { name: 'Chamada em outro dispositivo' }).textContent).toContain('Sala geral')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar por aqui' }))
    expect(join).toHaveBeenCalledWith('s-1', 'v-1')
  })

  it("isn't shown on the device that is in the call", () => {
    useVoice.setState({ phase: 'connected', serverId: 's-1', channelId: 'v-1' })
    render(<CallCard collapsed={false} meId={ME} />)
    expect(screen.queryByRole('region', { name: 'Chamada em outro dispositivo' })).toBeNull()
  })

  it('the device in the call leaves it when the call moves to another device', () => {
    useVoice.setState({ phase: 'connected', serverId: 's-1', channelId: 'v-1' })
    useChat.getState().applyEvent({ type: 'voice.device', data: { device: 'the-notebook' } })
    expect(handOff).toHaveBeenCalledOnce()
  })

  it('the device that took the call keeps it', () => {
    useVoice.setState({ phase: 'connected', serverId: 's-1', channelId: 'v-1' })
    useChat.getState().applyEvent({ type: 'voice.device', data: { device: DEVICE_ID } })
    expect(handOff).not.toHaveBeenCalled()
  })
})

describe("a room's list", () => {
  it('keeps who joined while a server reload was on its way', async () => {
    let answer: (detail: ServerDetail) => void = () => {}
    vi.spyOn(api, 'api').mockImplementation(() => new Promise((resolve) => (answer = resolve as typeof answer)))
    const reload = useChat.getState().refreshServer('s-1')
    // Bia joins meanwhile; the response was made before she did.
    useChat.getState().applyEvent({ type: 'voice.state', data: { server_id: 's-1', user_id: 'bia', state: inRoom('bia') } })
    await act(async () => {
      answer(server([inRoom(ME), inRoom('ana')]))
      await reload
    })
    expect(useChat.getState().servers['s-1'].voice_states.map((v) => v.user_id).sort()).toEqual(['ana', 'bia', ME].sort())
  })
})
