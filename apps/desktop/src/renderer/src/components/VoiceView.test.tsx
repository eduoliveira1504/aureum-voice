/** Fullscreen screen share: its controls hide (with the cursor) 2s after the mouse stops. */

import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useNav } from '../store/nav'
import { cameraTrackOf, useVoice } from '../store/voice'
import { CallControls, CallStage, useIdle } from './VoiceView'

vi.mock('../store/voice', async (original) => ({ ...(await original<typeof import('../store/voice')>()), cameraTrackOf: vi.fn() }))

const tiles = ['ana', 'bia', 'caio'].map((identity) => ({ key: `${identity}:person`, identity, kind: 'person' as const }))
const stage = (layout: 'grid' | 'focus'): void => {
  render(<CallStage tiles={tiles} layout={layout} focused={tiles[0]} people={new Map()} meId="me" onFocus={() => {}} />)
}

// Rings outside the tile get cut by the scrolling strip and stage, so they're drawn inside it.
describe('call tile ring', () => {
  beforeEach(() => useVoice.setState({ speaking: ['ana', 'bia'] } as never))

  const ringOf = (tile: HTMLElement): HTMLElement => tile.querySelector('[data-tile-ring]') as HTMLElement

  it('sits inside the tile in the grid', () => {
    stage('grid')
    const ring = ringOf(screen.getAllByRole('button', { name: 'Colocar Alguém em foco' })[0])
    expect(ring.dataset.tileRing).toBe('on')
    expect(ring.className).toContain('ring-inset')
    expect(ring.className).toContain('pointer-events-none')
  })

  it('sits inside the tile in the strip and in focus', () => {
    stage('focus')
    const strip = screen.getAllByRole('button', { name: 'Colocar Alguém em foco' })
    expect(ringOf(strip[0]).dataset.tileRing).toBe('on')
    expect(ringOf(strip[1]).dataset.tileRing).toBe('off')
    expect(ringOf(screen.getByLabelText('Alguém')).dataset.tileRing).toBe('on')
  })

  it('shows hover and keyboard focus inside the tile too', () => {
    stage('grid')
    const tile = screen.getAllByRole('button', { name: 'Colocar Alguém em foco' })[2]
    expect(tile.className).not.toMatch(/\bring-|hover:ring/)
    expect(ringOf(tile).className).toContain('group-hover:ring-2')
    expect(ringOf(tile).className).toContain('group-focus-visible:ring-2')
  })
})

describe('useIdle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('turns idle after the mouse stops and wakes when it moves', () => {
    const { result } = renderHook(() => useIdle(true, 2000))
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(1900))
    fireEvent.mouseMove(window)
    act(() => vi.advanceTimersByTime(1900))
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(200))
    expect(result.current).toBe(true)
    fireEvent.mouseMove(window)
    expect(result.current).toBe(false)
  })

  it('never goes idle while not watching (outside fullscreen)', () => {
    const { result } = renderHook(() => useIdle(false, 2000))
    act(() => vi.advanceTimersByTime(5000))
    expect(result.current).toBe(false)
  })
})

// A camera never loses its edges: what's left of the tile is the dark background.
describe('call tile video', () => {
  beforeEach(() => vi.mocked(cameraTrackOf).mockReturnValue({ attach: () => {}, detach: () => {} } as never))
  afterEach(() => vi.mocked(cameraTrackOf).mockReset())

  const videos = (): HTMLElement[] => [...document.querySelectorAll('video')]

  it('shows the whole camera in the grid', () => {
    stage('grid')
    expect(videos()).toHaveLength(3)
    for (const video of videos()) expect(video.className).toContain('object-contain')
    expect(screen.getAllByRole('button', { name: 'Colocar Alguém em foco' })[0].className).toContain('bg-scrim')
  })

  it('shows the whole camera in focus and in the strip', () => {
    stage('focus')
    expect(videos()).toHaveLength(3)
    for (const video of videos()) expect(video.className).toContain('object-contain')
    expect(screen.getByLabelText('Alguém').className).toContain('bg-scrim')
  })
})

// The header's button can sit under Windows' window buttons in fullscreen; this one never does.
describe('call controls fullscreen button', () => {
  beforeEach(() => {
    useVoice.setState({ phase: 'connected', serverId: null } as never)
    useNav.setState({ callFullscreen: false })
  })

  it('enters fullscreen', () => {
    render(<CallControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Tela cheia' }))
    expect(useNav.getState().callFullscreen).toBe(true)
  })

  it('leaves fullscreen', () => {
    useNav.setState({ callFullscreen: true })
    render(<CallControls fullscreen />)
    expect(screen.queryByRole('button', { name: 'Tela cheia' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sair da tela cheia (Esc)' }))
    expect(useNav.getState().callFullscreen).toBe(false)
  })
})
