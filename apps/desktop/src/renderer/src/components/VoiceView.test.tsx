/** Fullscreen screen share: its controls hide (with the cursor) 2s after the mouse stops. */

import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useNav } from '../store/nav'
import { useVoice } from '../store/voice'
import { CallControls, useIdle } from './VoiceView'

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
