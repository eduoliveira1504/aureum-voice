/** Starting with Windows: open the window (loading screen) or stay in the tray (block 3.23). */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppSettings } from '../../../shared/types'
import { WindowsSettings } from './WindowsSettings'

const base: AppSettings = { apiUrl: 'http://test', closeToTray: true, openAtLogin: true, loginStart: 'window', trayHintShown: true, language: 'pt-BR' }

function mockSettings(initial: AppSettings) {
  let current = initial
  vi.spyOn(window.aureum.settings, 'get').mockImplementation(async () => current)
  return vi.spyOn(window.aureum.settings, 'set').mockImplementation(async (patch) => (current = { ...current, ...patch }))
}

describe('Windows settings', () => {
  afterEach(() => vi.restoreAllMocks())

  it('opens the window by default and can switch to the tray', async () => {
    const set = mockSettings(base)
    render(<WindowsSettings />)
    expect(await screen.findByRole('radio', { name: 'Abrir a janela' })).toHaveProperty('ariaChecked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: 'Iniciar na bandeja' }))
    expect(set).toHaveBeenCalledWith({ loginStart: 'tray' })
    expect(await screen.findByText(/fica só no ícone da bandeja/)).toBeTruthy()
  })

  it('hides the choice while the app does not start with Windows', async () => {
    mockSettings({ ...base, openAtLogin: false })
    render(<WindowsSettings />)
    await screen.findByText('Iniciar com o Windows')
    expect(screen.queryByText('Ao ligar o PC')).toBeNull()
  })
})
