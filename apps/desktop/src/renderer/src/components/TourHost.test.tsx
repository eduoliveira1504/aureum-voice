/** When the tour starts (block 3.16), and that skipping it counts as done. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Onboarding, UserSettings } from '../lib/api'
import { TOUR_VERSION } from '../lib/onboarding'
import { DEFAULT_SETTINGS, useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { useOnboarding } from '../store/onboarding'
import { TourHost } from './TourHost'
import { TOUR_STEPS } from './tourSteps'

const start = (onboarding: Partial<Onboarding>): void => {
  const update = vi.fn((patch: Partial<UserSettings>) => useAppearance.setState((s) => ({ settings: { ...s.settings, ...patch } })))
  useAppearance.setState({ settings: { ...DEFAULT_SETTINGS, onboarding: { ...DEFAULT_SETTINGS.onboarding, ...onboarding } }, update } as never)
  useOnboarding.setState({ ready: true, tour: null, invite: false, tip: null })
}
const saved = (): Onboarding => useAppearance.getState().settings.onboarding
const later = (): Promise<void> => act(async () => {
  await vi.advanceTimersByTimeAsync(1000)
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  // No servers: the server steps are left out.
  useChat.setState({ loaded: true, servers: {}, order: [] })
})
afterEach(() => vi.useRealTimers())

describe('the first tour', () => {
  it('starts by itself on a new account, without the server steps', async () => {
    start({})
    render(<TourHost />)
    await later()
    expect(screen.getByRole('dialog', { name: 'Bem-vindo ao Aureum!' })).toBeTruthy()
    const shown = TOUR_STEPS.filter((s) => !s.needsServer).length
    expect(screen.getByText(`1/${shown}`)).toBeTruthy()
  })

  it('is saved as seen when skipped with Esc', async () => {
    start({})
    render(<TourHost />)
    await later()
    act(() => fireEvent.keyDown(window, { key: 'Escape' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(saved().tour_version_done).toBe(TOUR_VERSION)
  })

  it('asks once on an older account; "Agora não" never asks again', async () => {
    start({ tour_invite: true })
    render(<TourHost />)
    await later()
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Agora não' })))
    expect(saved()).toMatchObject({ tour_version_done: TOUR_VERSION, tour_invite: false })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"Sim" on the invite starts the tour', async () => {
    start({ tour_invite: true })
    render(<TourHost />)
    await later()
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Sim, bora' })))
    expect(screen.getByRole('dialog', { name: 'Bem-vindo ao Aureum!' })).toBeTruthy()
  })

  it('stays away once done, until "Rever tour"', async () => {
    start({ tour_version_done: TOUR_VERSION })
    render(<TourHost />)
    await later()
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => useOnboarding.getState().startTour())
    expect(screen.getByRole('dialog', { name: 'Bem-vindo ao Aureum!' })).toBeTruthy()
  })

  it('waits for the server to say whether it is due', async () => {
    start({})
    useOnboarding.setState({ ready: false })
    render(<TourHost />)
    await later()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
