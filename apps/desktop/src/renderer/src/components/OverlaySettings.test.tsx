/** Settings › Overlay: the games the overlay shows over, and the ones it's hidden in. */

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
  hiddenApps: ['r5apex'],
  games: ['myindiegame'],
  notGames: []
}
const state = (prefs: OverlayPrefs): OverlayState => ({ prefs, editing: false, failedShortcuts: [], notice: null, ask: null })

const bridge = vi.hoisted(() => {
  const overlay = window.aureum.overlay as unknown as { getState: ReturnType<typeof vi.fn>; setPrefs: ReturnType<typeof vi.fn> }
  overlay.getState.mockReturnValue(new Promise(() => {})) // the test sets the store itself
  return overlay
})

const { useOverlay } = await import('../store/overlay')
const { OverlaySettings } = await import('./OverlaySettings')

describe('overlay games', () => {
  beforeEach(() => {
    useOverlay.setState({ state: state(PREFS) })
    bridge.setPrefs.mockClear()
    bridge.setPrefs.mockImplementation(async (patch: Partial<OverlayPrefs>) => state({ ...PREFS, ...patch }))
    window.aureum.games.known = async () => [
      { name: 'Apex Legends', exe: ['r5apex.exe', 'r5apex_dx12.exe'] },
      { name: 'League of Legends', exe: ['League of Legends.exe'] }
    ]
    window.aureum.games.running = async () => [
      { exe: 'Notion.exe', title: '' },
      { exe: 'notion.exe', title: '' },
      { exe: 'Steam.exe', title: '' },
      { exe: 'League of Legends.exe', title: '' },
      { exe: 'MyIndieGame.exe', title: '' },
      { exe: 'r5apex.exe', title: '' },
      { exe: 'Unlisted.exe', title: '' }
    ]
  })

  const optionsOf = async (label: string): Promise<string[]> => {
    const picker = screen.getByLabelText(label) as HTMLSelectElement
    await act(async () => fireEvent.focus(picker))
    return [...picker.options].map((o) => o.value).filter(Boolean)
  }

  it('adds an open program as a game, never an exception or a game already known', async () => {
    render(<OverlaySettings />)
    await screen.findByText('Ver jogos conhecidos (2)')
    expect(await optionsOf('Adicionar jogo')).toEqual(['notion', 'unlisted'])
    fireEvent.change(screen.getByLabelText('Adicionar jogo'), { target: { value: 'unlisted' } })
    await waitFor(() => expect(bridge.setPrefs).toHaveBeenCalledWith({ games: ['myindiegame', 'unlisted'] }))
  })

  it('removes a game added by hand, and never asks about it again', async () => {
    render(<OverlaySettings />)
    fireEvent.click(screen.getByLabelText('Remover myindiegame.exe dos jogos com overlay'))
    await waitFor(() => expect(bridge.setPrefs).toHaveBeenCalledWith({ games: [], notGames: ['myindiegame'] }))
  })

  it('hides an open game, offering only games that are not hidden yet', async () => {
    render(<OverlaySettings />)
    await screen.findByText('Ver jogos conhecidos (2)')
    expect(await optionsOf('Ocultar jogo aberto')).toEqual(['league of legends', 'myindiegame'])
    fireEvent.change(screen.getByLabelText('Ocultar jogo aberto'), { target: { value: 'league of legends' } })
    await waitFor(() => expect(bridge.setPrefs).toHaveBeenCalledWith({ hiddenApps: ['r5apex', 'league of legends'] }))
  })

  it('shows a hidden game by name and shows the overlay there again', async () => {
    render(<OverlaySettings />)
    fireEvent.click(await screen.findByLabelText('Mostrar overlay de novo em Apex Legends'))
    await waitFor(() => expect(bridge.setPrefs).toHaveBeenCalledWith({ hiddenApps: [] }))
  })

  it('hides a known game with all its programs from the list', async () => {
    render(<OverlaySettings />)
    fireEvent.click(await screen.findByText('Ver jogos conhecidos (2)'))
    const row = screen.getByText('League of Legends').closest('li')!
    fireEvent.click(row.querySelector('button')!)
    await waitFor(() => expect(bridge.setPrefs).toHaveBeenCalledWith({ hiddenApps: ['r5apex', 'league of legends'] }))
  })
})
