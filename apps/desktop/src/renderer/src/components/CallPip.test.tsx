/** Floating call window: grabbing it anywhere (the photo too) moves it, never drags the image. */

import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useNav } from '../store/nav'
import { useVoice } from '../store/voice'
import { CallPip } from './CallPip'

vi.mock('../store/voice', async (original) => ({
  ...(await original<typeof import('../store/voice')>()),
  roomIdentities: () => ['me', 'ana'],
  cameraTrackOf: () => undefined,
  screenTrackOf: () => undefined
}))
vi.mock('../store/nav', async (original) => ({ ...(await original<typeof import('../store/nav')>()), useCallOnScreen: () => false }))
vi.mock('./CallCard', () => ({
  CallButtons: () => <button type="button">Microfone</button>,
  useCallContext: () => ({
    room: 'Sala',
    place: 'Servidor',
    people: new Map([['ana', { id: 'ana', display_name: 'Ana', avatar_url: '/media/ana.png' }]]),
    present: [],
    speakingText: 'Ninguém falando',
    open: () => {}
  })
}))

describe('call pip drag', () => {
  beforeEach(() => {
    useVoice.setState({ speaking: [] } as never)
    useNav.setState({ pipMinimized: false, pipCorner: 'bottom-right' })
    document.body.style.userSelect = ''
  })

  const pip = (): HTMLElement => screen.getByRole('dialog', { name: 'Chamada em Sala' })
  const photo = (): HTMLImageElement => pip().querySelector('img') as HTMLImageElement

  it('moves the window when grabbed by the photo instead of starting an image drag', () => {
    render(<CallPip meId="me" />)
    const down = createEvent.pointerDown(photo(), { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent(photo(), down)
    expect(down.defaultPrevented).toBe(true)
    expect(document.body.style.userSelect).toBe('none')

    const drag = createEvent.dragStart(photo())
    fireEvent(photo(), drag)
    expect(drag.defaultPrevented).toBe(true)

    fireEvent.pointerMove(pip(), { clientX: 40, clientY: 40 })
    expect(pip().style.left).not.toBe('')
    fireEvent.pointerUp(pip(), { clientX: 0, clientY: 0 })
    expect(pip().style.left).toBe('')
    expect(useNav.getState().pipCorner).toBe('top-left')
    expect(document.body.style.userSelect).toBe('')
  })

  it('lets go of text selection if the gesture is cancelled', () => {
    render(<CallPip meId="me" />)
    fireEvent.pointerDown(photo(), { pointerId: 1 })
    fireEvent.pointerCancel(pip())
    expect(document.body.style.userSelect).toBe('')
  })

  it('leaves the buttons alone', () => {
    render(<CallPip meId="me" />)
    const button = screen.getByRole('button', { name: 'Microfone' })
    const down = createEvent.pointerDown(button, { pointerId: 1 })
    fireEvent(button, down)
    expect(down.defaultPrevented).toBe(false)
    expect(document.body.style.userSelect).toBe('')
  })
})
