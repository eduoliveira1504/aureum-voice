/** The accent picker: dragging only repaints the page; releasing applies and saves once. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import { useAppearance } from '../store/appearance'
import { AppearanceSettings } from './AppearanceSettings'

const root = document.documentElement

describe('accent picker', () => {
  let save: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    save = vi.spyOn(api, 'api').mockResolvedValue(useAppearance.getState().settings)
    useAppearance.setState({ settings: { ...useAppearance.getState().settings, accent_color: '#E8B531' } })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('previews while dragging without touching settings, then saves once on release', async () => {
    render(<AppearanceSettings />)
    const picker = screen.getByLabelText('Escolher outra cor') as HTMLInputElement

    for (const color of ['#112233', '#223344', '#8b5cf6']) {
      fireEvent.input(picker, { target: { value: color } })
      await act(() => vi.advanceTimersByTimeAsync(20)) // a frame
    }
    expect(useAppearance.getState().settings.accent_color).toBe('#E8B531')
    expect(root.style.getPropertyValue('--accent')).toBe('#8B5CF6')
    expect(root.dataset.accentPreview).toBe('')

    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(save).not.toHaveBeenCalled()

    fireEvent.change(picker, { target: { value: '#8b5cf6' } })
    expect(useAppearance.getState().settings.accent_color).toBe('#8B5CF6')
    expect(root.dataset.accentPreview).toBeUndefined()

    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('/users/me/settings', { method: 'PATCH', body: { accent_color: '#8B5CF6' } })
  })

  it('closing the picker on the same color restores it and saves nothing', async () => {
    render(<AppearanceSettings />)
    const picker = screen.getByLabelText('Escolher outra cor') as HTMLInputElement

    fireEvent.input(picker, { target: { value: '#112233' } })
    await act(() => vi.advanceTimersByTimeAsync(20))
    fireEvent.change(picker, { target: { value: '#e8b531' } })

    expect(root.style.getPropertyValue('--accent')).toBe('#E8B531')
    expect(root.dataset.accentPreview).toBeUndefined()
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(save).not.toHaveBeenCalled()
  })
})
