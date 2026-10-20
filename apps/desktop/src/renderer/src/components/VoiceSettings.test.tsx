/** Settings › Voz e vídeo: processing switches, sensitivity and the Bluetooth hint. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadMediaPrefs } from '../lib/mediaPrefs'
import { useVoice } from '../store/voice'
import { VoiceSettings } from './VoiceSettings'

const device = (kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo =>
  ({ kind, deviceId, label, groupId: '' }) as MediaDeviceInfo

function mockDevices(inputs: MediaDeviceInfo[]): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: async () => inputs,
      getUserMedia: async () => {
        throw new Error('no mic in tests')
      },
      addEventListener: () => {},
      removeEventListener: () => {}
    }
  })
}

describe('voice settings', () => {
  let reopen: ReturnType<typeof vi.fn>
  let reprocess: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    mockDevices([device('audioinput', 'default', 'Padrão - Microfone (Realtek USB)')])
    reopen = vi.fn(async () => {})
    reprocess = vi.fn(async () => {})
    useVoice.setState({ applyDevicePrefs: reopen, applyMicProcessing: reprocess } as never)
  })
  afterEach(() => vi.restoreAllMocks())

  it('has noise suppression, echo cancellation and auto gain on by default, each switched apart', () => {
    render(<VoiceSettings />)
    const toggle = (title: string): HTMLInputElement =>
      screen.getByRole('checkbox', { name: new RegExp(`^${title}`) }) as HTMLInputElement
    for (const title of ['Supressão de ruído', 'Cancelamento de eco', 'Ganho automático']) {
      expect(toggle(title).checked).toBe(true)
    }

    fireEvent.click(toggle('Cancelamento de eco'))
    expect(loadMediaPrefs()).toMatchObject({ echoCancellation: false, autoGainControl: true, noiseSuppression: true })
    expect(reopen).toHaveBeenCalledTimes(1) // the capture changes: the mic is reopened

    fireEvent.click(toggle('Supressão de ruído'))
    expect(loadMediaPrefs().noiseSuppression).toBe(false)
    expect(reprocess).toHaveBeenCalledTimes(1) // only the processing changes
    expect(reopen).toHaveBeenCalledTimes(1)
  })

  it('shows the threshold slider only with manual sensitivity, and moves it live', () => {
    render(<VoiceSettings />)
    expect(screen.queryByLabelText('Sensibilidade do microfone')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Manual' }))
    const slider = screen.getByLabelText('Sensibilidade do microfone')
    fireEvent.change(slider, { target: { value: '-35' } })
    expect(loadMediaPrefs()).toMatchObject({ sensitivity: 'manual', gateDb: -35 })
    expect(reopen).not.toHaveBeenCalled()
  })

  it('shows the device in use, and the Bluetooth hint for a Hands-Free mic', async () => {
    const { unmount } = render(<VoiceSettings />)
    expect(await screen.findByText('Em uso: Padrão - Microfone (Realtek USB)')).toBeTruthy()
    expect(screen.queryByRole('note')).toBeNull()
    unmount()

    mockDevices([device('audioinput', 'default', 'Padrão - Fone de ouvido (Fone XYZ Hands-Free AG Audio)')])
    render(<VoiceSettings />)
    await waitFor(() => expect(screen.getByRole('note').textContent).toContain('Fones Bluetooth perdem qualidade'))
  })
})
