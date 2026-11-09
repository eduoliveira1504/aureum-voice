/** Configurações › Dicas (block 3.16). */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { UserSettings } from '../lib/api'
import { DEFAULT_SETTINGS, useAppearance } from '../store/appearance'
import { useOnboarding } from '../store/onboarding'
import { TipsSettings } from './TipsSettings'

beforeEach(() => {
  const update = vi.fn((patch: Partial<UserSettings>) => useAppearance.setState((s) => ({ settings: { ...s.settings, ...patch } })))
  const onboarding = { tour_version_done: 1, tour_invite: false, tips_seen: ['call.controls', 'dm.receipts'] }
  useAppearance.setState({ settings: { ...DEFAULT_SETTINGS, onboarding }, update } as never)
  useOnboarding.setState({ ready: true, tour: null, invite: false, tip: null })
})

describe('Configurações › Dicas', () => {
  it('brings the tips back, keeping the tour done', () => {
    render(<TipsSettings onClose={() => {}} />)
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Mostrar dicas de novo' })))
    expect(useAppearance.getState().settings.onboarding).toEqual({ tour_version_done: 1, tour_invite: false, tips_seen: [] })
    expect(screen.getByRole('button', { name: 'Mostrar dicas de novo' })).toHaveProperty('disabled', true)
  })

  it('closes the settings and starts the tour', () => {
    const onClose = vi.fn()
    render(<TipsSettings onClose={onClose} />)
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Rever tour' })))
    expect(onClose).toHaveBeenCalled()
    expect(useOnboarding.getState().tour).toEqual({})
  })
})
