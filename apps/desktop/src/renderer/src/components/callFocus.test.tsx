/**
 * Block 4.2.9: the floating window shows the call like the call screen in focus mode. 1 to 1 shows
 * the other person, a shared screen comes first, a pin is the same everywhere, and people joining or
 * leaving don't make it jump.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { pickFocus, thumbnails, type Tile } from '../lib/callFocus'
import { useNav } from '../store/nav'
import { useVoice } from '../store/voice'
import { CallPip } from './CallPip'
import { CallView } from './VoiceView'

const room = vi.hoisted(() => ({ ids: ['me', 'ana'] as string[], sharing: [] as string[] }))

vi.mock('../store/voice', async (original) => ({
  ...(await original<typeof import('../store/voice')>()),
  roomIdentities: () => room.ids,
  isSharing: (id: string) => room.sharing.includes(id),
  cameraTrackOf: () => undefined,
  screenTrackOf: () => undefined
}))
vi.mock('../store/nav', async (original) => ({ ...(await original<typeof import('../store/nav')>()), useCallOnScreen: () => false }))

const NAMES: Record<string, string> = { me: 'Eu', ana: 'Ana', bia: 'Bia', caio: 'Caio', duda: 'Duda', edu: 'Edu' }
const PEOPLE = new Map(Object.entries(NAMES).map(([id, display_name]) => [id, { id, display_name, avatar_url: null, badges: [] }]))

vi.mock('./CallCard', () => ({
  CallButtons: () => <button type="button">Microfone</button>,
  useCallContext: () => ({ room: 'Sala', place: 'Servidor', people: PEOPLE, present: [], speakingText: '', open: () => {} })
}))

const person = (id: string): Tile => ({ key: `${id}:person`, identity: id, kind: 'person' })
const shared = (id: string): Tile => ({ key: `${id}:screen`, identity: id, kind: 'screen' })
const base = { pinned: null, meId: 'me', speaking: [], previous: null }

describe('pickFocus', () => {
  it('1 to 1 shows the other person, even while I speak', () => {
    expect(pickFocus([person('me'), person('ana')], { ...base, speaking: ['me'] })?.key).toBe('ana:person')
  })

  it('alone, shows me', () => {
    expect(pickFocus([person('me')], base)?.key).toBe('me:person')
  })

  it('a shared screen comes before who speaks, but never my own', () => {
    const tiles = [shared('me'), shared('bia'), person('me'), person('ana'), person('bia')]
    expect(pickFocus(tiles, { ...base, speaking: ['ana'] })?.key).toBe('bia:screen')
    expect(pickFocus([shared('me'), person('me'), person('ana')], base)?.key).toBe('ana:person')
  })

  it('a pin comes first, and is dropped when its tile goes', () => {
    const tiles = [shared('bia'), person('me'), person('ana'), person('bia')]
    expect(pickFocus(tiles, { ...base, pinned: 'ana:person' })?.key).toBe('ana:person')
    expect(pickFocus(tiles, { ...base, pinned: 'caio:person' })?.key).toBe('bia:screen')
  })

  it('in a group, follows who speaks and keeps them between sentences', () => {
    const tiles = [person('me'), person('ana'), person('bia'), person('caio')]
    expect(pickFocus(tiles, { ...base, speaking: ['bia'] })?.key).toBe('bia:person')
    expect(pickFocus(tiles, { ...base, previous: 'bia:person' })?.key).toBe('bia:person')
  })

  it('lists the others as thumbnails, with how many are left out', () => {
    const tiles = ['me', 'ana', 'bia', 'caio', 'duda'].map(person)
    const { shown, more } = thumbnails(tiles, tiles[1], 3)
    expect(shown.map((t) => t.identity)).toEqual(['me', 'bia', 'caio'])
    expect(more).toBe(1)
  })
})

describe('floating window', () => {
  beforeEach(() => {
    room.ids = ['me', 'ana']
    room.sharing = []
    useVoice.setState({ phase: 'connected', channelId: 'c-1', speaking: [] } as never)
    useNav.setState({ pipMinimized: false, callDetached: false, callPin: null, pipCorner: 'bottom-right' })
  })

  const pip = (): HTMLElement => screen.getByRole('dialog', { name: 'Chamada em Sala' })
  /** The big tile: the only one that isn't a button. */
  const big = (): string | null => pip().querySelector('[aria-label]:not([role="button"]):not([role="dialog"])')?.getAttribute('aria-label') ?? null
  const minis = (): string[] =>
    within(pip())
      .queryAllByRole('button', { name: /^Colocar .* em foco$/ })
      .map((b) => b.getAttribute('aria-label') ?? '')

  it('1 to 1 shows the other person big and me as a thumbnail', () => {
    render(<CallPip meId="me" />)
    expect(big()).toBe('Ana')
    expect(minis()).toEqual(['Colocar Eu em foco'])
  })

  it('a shared screen takes the big place', () => {
    room.ids = ['me', 'ana', 'bia']
    room.sharing = ['bia']
    render(<CallPip meId="me" />)
    expect(big()).toBe('Tela de Bia')
  })

  it('clicking someone pins them, and the call screen shows the same pin', () => {
    room.ids = ['me', 'ana', 'bia']
    const { unmount } = render(<CallPip meId="me" />)
    act(() => fireEvent.click(within(pip()).getByRole('button', { name: 'Colocar Bia em foco' })))
    expect(useNav.getState().callPin).toEqual({ channelId: 'c-1', key: 'bia:person' })
    expect(big()).toBe('Bia')
    unmount()

    render(<CallView title="Sala" channelId="c-1" people={PEOPLE as never} present={[]} joinLabel="Entrar" onJoin={() => {}} meId="me" />)
    // Focus layout, with the pinned one big (not a button) and the others in the strip.
    expect(screen.getByLabelText('Bia').getAttribute('role')).toBeNull()
    expect(screen.getByRole('button', { name: 'Colocar Ana em foco' })).toBeTruthy()
  })

  it('a pin from another call is ignored', () => {
    room.ids = ['me', 'ana', 'bia']
    useNav.setState({ callPin: { channelId: 'outra', key: 'bia:person' } })
    render(<CallPip meId="me" />)
    expect(big()).toBe('Ana')
  })

  it("people joining or leaving don't make it jump", () => {
    room.ids = ['me', 'ana']
    const { rerender } = render(<CallPip meId="me" />)
    expect(big()).toBe('Ana')
    room.ids = ['me', 'bia', 'ana']
    act(() => useVoice.setState({ version: 1 } as never))
    rerender(<CallPip meId="me" />)
    expect(big()).toBe('Ana')
    room.ids = ['me', 'ana']
    act(() => useVoice.setState({ version: 2 } as never))
    rerender(<CallPip meId="me" />)
    expect(big()).toBe('Ana')
  })

  it('shows up to three thumbnails and "+N" for the rest', () => {
    room.ids = ['me', 'ana', 'bia', 'caio', 'duda', 'edu']
    render(<CallPip meId="me" />)
    expect(minis()).toHaveLength(3)
    expect(within(pip()).getByRole('button', { name: 'Mais 2 na chamada' }).textContent).toBe('+2')
  })

  it('has only the minimal controls', () => {
    render(<CallPip meId="me" />)
    const labels = within(pip())
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent)
      .filter((l) => !l?.startsWith('Colocar'))
    expect(labels).toEqual(['Microfone', 'Voltar à chamada', 'Destacar chamada', 'Esconder janelinha'])
  })
})
