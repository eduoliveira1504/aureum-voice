/**
 * Block 4.2.5: "Jogando X · há 2 h" in the friends list and Home, the time going up on its own, and
 * the line going away as soon as the server says the activity ended (app closed, no signal,
 * detection turned off, invisible).
 */

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Activity } from '../lib/api'
import { useActivity } from '../store/activity'
import { activityWithTime, ActivityLine } from './profileBits'

const NOW = new Date('2026-11-22T20:00:00Z').getTime()
const playing = (minutesAgo: number): Activity =>
  ({ type: 'playing', name: 'VALORANT', started_at: new Date(NOW - minutesAgo * 60_000).toISOString() }) as Activity

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  useActivity.setState({ byUser: { ana: playing(120) } })
})
afterEach(() => vi.useRealTimers())

describe('live activity', () => {
  it('shows the game with how long it has been going', () => {
    render(<ActivityLine userId="ana" withTime />)
    expect(screen.getByText('Jogando VALORANT · há 2 h')).toBeTruthy()
  })

  it('keeps the plain line where no time is asked for', () => {
    render(<ActivityLine userId="ana" />)
    expect(screen.getByText('Jogando VALORANT')).toBeTruthy()
  })

  it('the time goes up by itself', () => {
    useActivity.setState({ byUser: { ana: playing(58) } })
    render(<ActivityLine userId="ana" withTime />)
    expect(screen.getByText('Jogando VALORANT · há 58 min')).toBeTruthy()
    act(() => void vi.advanceTimersByTime(2 * 60_000))
    expect(screen.getByText('Jogando VALORANT · há 1 h')).toBeTruthy()
    act(() => void vi.advanceTimersByTime(15 * 60_000))
    expect(screen.getByText('Jogando VALORANT · há 1 h 15 min')).toBeTruthy()
  })

  it('goes away when the activity ends, and when the person goes offline or invisible', () => {
    render(<ActivityLine userId="ana" withTime />)
    act(() => useActivity.getState().applyEvent({ type: 'activity.updated', data: { user_id: 'ana', activity: null } } as never))
    expect(screen.queryByText(/VALORANT/)).toBeNull()

    act(() => useActivity.setState({ byUser: { ana: playing(5) } }))
    expect(screen.getByText(/VALORANT/)).toBeTruthy()
    act(() => useActivity.getState().applyEvent({ type: 'presence.updated', data: { user_id: 'ana', status: 'offline', online: false, activity: null } } as never))
    expect(screen.queryByText(/VALORANT/)).toBeNull()
  })

  it('reads as just the game when there is no time yet', () => {
    expect(activityWithTime(playing(0), null)).toBe('Jogando VALORANT')
    expect(activityWithTime(playing(0), 'agora há pouco')).toBe('Jogando VALORANT · agora há pouco')
  })
})
