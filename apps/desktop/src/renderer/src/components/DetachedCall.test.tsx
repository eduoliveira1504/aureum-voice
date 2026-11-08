/** Detached call window: opens and closes without leaving the call, and never connects again. */

import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useNav } from '../store/nav'
import { useVoice } from '../store/voice'
import { CallPip } from './CallPip'
import { DetachedCallHost } from './DetachedCall'

vi.mock('../store/voice', async (original) => ({
  ...(await original<typeof import('../store/voice')>()),
  roomIdentities: () => ['me', 'ana'],
  cameraTrackOf: () => undefined,
  screenTrackOf: () => undefined
}))
vi.mock('../store/nav', async (original) => ({ ...(await original<typeof import('../store/nav')>()), useCallOnScreen: () => false }))
vi.mock('./CallCard', () => ({
  CallButtons: ({ detached }: { detached?: boolean }) => <button type="button">{detached ? 'Microfone (destacada)' : 'Microfone'}</button>,
  useCallContext: () => ({
    room: 'Sala',
    place: 'Servidor',
    people: new Map([['ana', { id: 'ana', display_name: 'Ana', avatar_url: '/media/ana.png' }]]),
    present: [],
    speakingText: 'Ninguém falando',
    open: () => {}
  })
}))

/** A stand-in for the window window.open returns: its own document, closable from outside. */
function fakePopup() {
  // An iframe's document: a page of its own, with a window, like the real popup.
  const frame = document.createElement('iframe')
  document.documentElement.appendChild(frame)
  const doc = frame.contentDocument as Document
  const events = new EventTarget()
  return {
    document: doc,
    screenX: 100,
    screenY: 50,
    close: vi.fn(),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    /** Alt+F4 or the taskbar's close. */
    closeFromOutside: () => events.dispatchEvent(new Event('pagehide'))
  }
}

describe('detached call window', () => {
  let popup: ReturnType<typeof fakePopup>
  let open: ReturnType<typeof vi.fn>
  let join: ReturnType<typeof vi.fn>
  let leave: ReturnType<typeof vi.fn>

  beforeEach(() => {
    popup = fakePopup()
    open = vi.fn(() => popup)
    vi.stubGlobal('open', open)
    // The store's join is the only place that creates and connects a LiveKit room.
    join = vi.fn()
    leave = vi.fn()
    useVoice.setState({ phase: 'connected', speaking: [], leave, join } as never)
    useNav.setState({ callDetached: false, pipMinimized: false, pipCorner: 'bottom-right' })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.querySelectorAll('iframe').forEach((f) => f.remove())
  })

  const view = () => within(popup.document.body)
  const renderBoth = () =>
    render(
      <>
        <CallPip meId="me" />
        <DetachedCallHost meId="me" />
      </>
    )
  const detach = () => act(() => fireEvent.click(screen.getByRole('button', { name: 'Destacar chamada' })))

  it('opens from the floating window, which hides meanwhile, without a second connection', () => {
    renderBoth()
    expect(open).not.toHaveBeenCalled()
    detach()
    expect(open).toHaveBeenCalledOnce()
    expect(open.mock.calls[0][0]).toBe('about:blank')
    expect(open.mock.calls[0][1]).toMatch(/^aureum-call-\d+$/)
    expect(view().getByRole('dialog', { name: 'Chamada destacada em Sala' })).toBeTruthy()
    expect(view().getByRole('button', { name: 'Microfone (destacada)' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Chamada em Sala' })).toBeNull()
    // Same room, same tracks: nothing connects again.
    expect(join).not.toHaveBeenCalled()
  })

  it('closes with its X back to the floating window, still in the call', () => {
    renderBoth()
    detach()
    act(() => fireEvent.click(view().getByRole('button', { name: 'Fechar janela destacada' })))
    expect(popup.close).toHaveBeenCalled()
    expect(useNav.getState().callDetached).toBe(false)
    expect(leave).not.toHaveBeenCalled()
    expect(useVoice.getState().phase).toBe('connected')
    expect(screen.getByRole('dialog', { name: 'Chamada em Sala' })).toBeTruthy()
  })

  it('"Voltar ao app" closes it and brings the app forward', () => {
    renderBoth()
    detach()
    act(() => fireEvent.click(view().getByRole('button', { name: 'Voltar ao app' })))
    expect(window.aureum.window.show).toHaveBeenCalled()
    expect(useNav.getState().callDetached).toBe(false)
    expect(leave).not.toHaveBeenCalled()
  })

  it('closed from outside (Alt+F4), the floating window comes back', () => {
    renderBoth()
    detach()
    act(() => popup.closeFromOutside())
    expect(useNav.getState().callDetached).toBe(false)
    expect(screen.getByRole('dialog', { name: 'Chamada em Sala' })).toBeTruthy()
  })

  it('leaving the call closes it', () => {
    renderBoth()
    detach()
    act(() => useVoice.setState({ phase: 'idle' }))
    expect(popup.close).toHaveBeenCalled()
    expect(useNav.getState().callDetached).toBe(false)
  })

  it('switches between focus and grid', () => {
    renderBoth()
    detach()
    // Focus: just who it shows (Ana, the only other person).
    expect(popup.document.querySelectorAll('[data-tile]')).toHaveLength(1)
    act(() => fireEvent.click(view().getByRole('button', { name: 'Mostrar em grade' })))
    expect(popup.document.querySelectorAll('[data-tile]')).toHaveLength(2)
    act(() => fireEvent.click(view().getByRole('button', { name: 'Mostrar em foco' })))
    expect(popup.document.querySelectorAll('[data-tile]')).toHaveLength(1)
  })

  it('turns "fixar por cima" off and on', async () => {
    renderBoth()
    detach()
    const pin = await view().findByRole('button', { name: 'Deixar de fixar por cima' })
    act(() => fireEvent.click(pin))
    expect(window.aureum.callWindow.setPinned).toHaveBeenLastCalledWith(false)
    act(() => fireEvent.click(view().getByRole('button', { name: 'Fixar por cima' })))
    expect(window.aureum.callWindow.setPinned).toHaveBeenLastCalledWith(true)
  })

  it('moves when grabbed by the photo, and leaves the buttons alone', () => {
    renderBoth()
    detach()
    const win = view().getByRole('dialog', { name: 'Chamada destacada em Sala' })
    const photo = win.querySelector('img') as HTMLImageElement
    const down = createEvent.pointerDown(photo, { button: 0, screenX: 500, screenY: 400, pointerId: 1 })
    fireEvent(photo, down)
    expect(down.defaultPrevented).toBe(true)
    fireEvent.pointerMove(win, { screenX: 530, screenY: 380 })
    expect(window.aureum.callWindow.move).toHaveBeenLastCalledWith(130, 30)
    fireEvent.pointerUp(win)

    const button = view().getByRole('button', { name: 'Fechar janela destacada' })
    const onButton = createEvent.pointerDown(button, { button: 0, pointerId: 2 })
    fireEvent(button, onButton)
    expect(onButton.defaultPrevented).toBe(false)
  })
})
