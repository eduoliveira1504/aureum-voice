/** Settings › Overlay: the games the overlay shows over, and the ones it's hidden in. */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_WIDGETS } from '../../../shared/overlayWidgets'
import type { OverlayPrefs, OverlayPrefsPatch, OverlayState } from '../../../shared/types'

const PREFS: OverlayPrefs = {
  enabled: true,
  toggleShortcut: 'Control+Shift+F9',
  editShortcut: 'Control+Shift+F10',
  widgets: DEFAULT_WIDGETS,
  hiddenApps: ['r5apex'],
  games: ['myindiegame'],
  notGames: []
}
const state = (prefs: OverlayPrefs): OverlayState => ({ prefs, editing: false, failedShortcuts: [], notice: null, ask: null, cameraCorner: 'top-left', hiddenWhileSharing: false, captureExclusion: true })

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
    bridge.setPrefs.mockImplementation(async (patch: OverlayPrefsPatch) => state({ ...PREFS, ...patch } as OverlayPrefs))
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

describe('overlay widgets', () => {
  beforeEach(() => {
    useOverlay.setState({ state: state(PREFS) })
    bridge.setPrefs.mockClear()
    bridge.setPrefs.mockResolvedValue(state(PREFS))
  })

  it('turns one widget off without touching the others', async () => {
    render(<OverlaySettings />)
    const toggle = screen.getByText('Câmeras').closest('label')!.querySelector('input')!
    fireEvent.click(toggle)
    await waitFor(() => expect(bridge.setPrefs).toHaveBeenCalledWith({ widgets: { cameras: { enabled: false } } }))
  })

  it('picks the layout of the cameras', async () => {
    render(<OverlaySettings />)
    fireEvent.click(screen.getByText('Horizontal'))
    await waitFor(() => expect(bridge.setPrefs).toHaveBeenCalledWith({ widgets: { cameras: { layout: 'horizontal' } } }))
  })

  it('picks the grid, and only then asks how many per row', async () => {
    render(<OverlaySettings />)
    expect(screen.queryByLabelText('Câmeras por linha')).toBeNull()
    fireEvent.click(screen.getByText('Grade'))
    await waitFor(() => expect(bridge.setPrefs).toHaveBeenCalledWith({ widgets: { cameras: { layout: 'grid' } } }))
    useOverlay.setState({ state: state({ ...PREFS, widgets: { ...DEFAULT_WIDGETS, cameras: { ...DEFAULT_WIDGETS.cameras, layout: 'grid' } } }) })
    fireEvent.change(await screen.findByLabelText('Câmeras por linha'), { target: { value: '3' } })
    await waitFor(() => expect(bridge.setPrefs).toHaveBeenCalledWith({ widgets: { cameras: { perRow: 3 } } }))
  })

  it('sizes the cameras with the slider or a shortcut, and sets how many show and the spacing', async () => {
    bridge.setPrefs.mockResolvedValue(state(PREFS))
    render(<OverlaySettings />)
    fireEvent.change(screen.getByLabelText('Largura de cada câmera'), { target: { value: '300' } })
    await waitFor(() => expect(bridge.setPrefs).toHaveBeenCalledWith({ widgets: { cameras: { tileWidth: 300 } } }))
    // Voz, Câmeras and Notificações each have one.
    fireEvent.click(screen.getAllByText('Grande')[1])
    await waitFor(() => expect(bridge.setPrefs).toHaveBeenCalledWith({ widgets: { cameras: { size: 'large' } } }))
    fireEvent.change(screen.getByLabelText('Câmeras visíveis no máximo'), { target: { value: '6' } })
    await waitFor(() => expect(bridge.setPrefs).toHaveBeenCalledWith({ widgets: { cameras: { maxVisible: 6 } } }))
    fireEvent.change(screen.getByLabelText('Espaço entre as câmeras'), { target: { value: '0' } })
    await waitFor(() => expect(bridge.setPrefs).toHaveBeenCalledWith({ widgets: { cameras: { gap: 0 } } }))
    fireEvent.click(screen.getByText('Cantos arredondados').closest('label')!.querySelector('input')!)
    await waitFor(() => expect(bridge.setPrefs).toHaveBeenCalledWith({ widgets: { cameras: { rounded: false } } }))
  })

  it('previews the cameras box at its biggest, following format, width and count', () => {
    const cameras = { ...DEFAULT_WIDGETS.cameras, layout: 'horizontal' as const, tileWidth: 100, gap: 4, maxVisible: 3 }
    useOverlay.setState({ state: state({ ...PREFS, widgets: { ...DEFAULT_WIDGETS, cameras } }) })
    render(<OverlaySettings />)
    const preview = screen.getByTestId('overlay-preview-cameras')
    expect(preview.textContent).toContain('3 câmeras')
    // Three 100 px cameras in a row, 4 px apart, plus 8 px of padding each side; 56 px tall.
    expect(preview.textContent).toContain('324 × 72 px')
    expect(screen.getByTestId('overlay-camera-box').style.width).toBe('324px')
  })

  it('draws a box too big for the column to scale', () => {
    const cameras = { ...DEFAULT_WIDGETS.cameras, layout: 'horizontal' as const, tileWidth: 360, maxVisible: 8 }
    useOverlay.setState({ state: state({ ...PREFS, widgets: { ...DEFAULT_WIDGETS, cameras } }) })
    render(<OverlaySettings />)
    expect(screen.getByTestId('overlay-preview-cameras').textContent).toMatch(/prévia em \d+%/)
    expect(parseFloat(screen.getByTestId('overlay-camera-box').style.width)).toBeLessThanOrEqual(420)
  })

  it('previews each widget that is on, at its own opacity, and hides the content when asked', () => {
    const widgets = structuredClone(DEFAULT_WIDGETS)
    widgets.voice.opacity = 40
    widgets.cameras.enabled = false
    widgets.notifications.hideContent = true
    useOverlay.setState({ state: state({ ...PREFS, widgets }) })
    render(<OverlaySettings />)
    const voice = screen.getByTestId('overlay-preview-voice')
    expect((voice.firstElementChild as HTMLElement).style.opacity).toBe('0.4')
    expect(screen.queryByTestId('overlay-preview-cameras')).toBeNull()
    const notification = screen.getByTestId('overlay-preview-notifications')
    expect(notification.textContent).toContain('@ana te mandou mensagem')
    expect(notification.textContent).not.toContain('partida')
  })

  it('has no way into edit mode with every widget off', () => {
    const widgets = structuredClone(DEFAULT_WIDGETS)
    widgets.voice.enabled = widgets.cameras.enabled = widgets.notifications.enabled = false
    useOverlay.setState({ state: state({ ...PREFS, widgets }) })
    render(<OverlaySettings />)
    expect((screen.getByRole('button', { name: 'Editar posição e tamanho' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('overlay in screen shares (3.24 A)', () => {
  const NOTE = 'Seu Windows mostra o overlay como quadrado preto em transmissões; ele será escondido enquanto você transmite.'

  it('warns when this Windows cannot leave the overlay out of captures', async () => {
    useOverlay.setState({ state: { ...state(PREFS), captureExclusion: false } })
    render(<OverlaySettings />)
    expect(await screen.findByText(NOTE)).toBeTruthy()
  })

  it('says nothing on a Windows that can', async () => {
    useOverlay.setState({ state: state(PREFS) })
    render(<OverlaySettings />)
    await screen.findByText('Editar posição e tamanho')
    expect(screen.queryByText(NOTE)).toBeNull()
  })

  it('turns edit mode off while the overlay is hidden for a share', async () => {
    useOverlay.setState({ state: { ...state(PREFS), hiddenWhileSharing: true } })
    render(<OverlaySettings />)
    const edit = (await screen.findByText('Editar posição e tamanho')).closest('button')!
    expect(edit.disabled).toBe(true)
    expect(screen.getByText('O overlay fica escondido enquanto você transmite a tela.')).toBeTruthy()
  })
})
