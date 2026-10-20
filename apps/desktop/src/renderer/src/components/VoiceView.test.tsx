/** Fullscreen screen share: its controls hide (with the cursor) 2s after the mouse stops. */

import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useIdle } from './VoiceView'

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
