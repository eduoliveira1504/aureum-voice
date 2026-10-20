/** Settings › Overlay: the user's own "hide the overlay over this app" list. */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OverlayPrefs, OverlayState } from '../../../shared/types'

const PREFS: OverlayPrefs = {
  enabled: true,
  toggleShortcut: 'Control+Shift+F9',
  editShortcut: 'Control+Shift+F10',
  bounds: null,
  size: 'medium',
  opacity: 100,
  showCameras: true,
  onlySpeaking: false,
  hiddenApps: ['obs64']
}
const state = (prefs: OverlayPrefs): OverlayState => ({ prefs, editing: false, failedShortcuts: [], notice: null })

const bridge = vi.hoisted(() => {
  const overlay = window.aureum.overlay as unknown as { getState: ReturnType<typeof vi.fn>; setPrefs: ReturnType<typeof vi.fn> }
  overlay.getState.mockReturnValue(new Promise(() => {})) // the test sets the store itself
  return overlay
})

const { useOverlay } = await import('../store/overlay')
const { OverlaySettings } = await import('./OverlaySettings')

describe('hide the overlay over an app', () => {
  beforeEach(() => {
    useOverlay.setState({ state: state(PREFS) })
    bridge.setPrefs.mockImplementation(async (patch: Partial<OverlayPrefs>) => state({ ...PREFS, ...patch }))
    window.aureum.games.running = async () => [
      { exe: 'Notion.exe', title: '' },
      { exe: 'obs64.exe', title: '' },
      { exe: 'notion.exe', title: '' }
    ]
  })

  it('lists the hidden apps and removes one', async () => {
    render(<OverlaySettings />)
    expect(screen.getByText('obs64.exe')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Mostrar overlay de novo em obs64.exe'))
    await waitFor(() => expect(bridge.setPrefs).toHaveBeenCalledWith({ hiddenApps: [] }))
  })

  it('adds an open app, offering each program once and not the ones already hidden', async () => {
    render(<OverlaySettings />)
    const picker = screen.getByLabelText('Adicionar app') as HTMLSelectElement
    await act(async () => fireEvent.focus(picker))
    const options = [...picker.options].map((o) => o.value).filter(Boolean)
    expect(options).toEqual(['notion'])
    fireEvent.change(picker, { target: { value: 'notion' } })
    await waitFor(() => expect(bridge.setPrefs).toHaveBeenCalledWith({ hiddenApps: ['obs64', 'notion'] }))
  })
})
