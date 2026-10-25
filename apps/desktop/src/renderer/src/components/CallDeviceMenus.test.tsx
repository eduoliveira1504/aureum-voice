/** The device menus of a call: the arrow next to the mic, headphone and camera buttons. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadMediaPrefs } from '../lib/mediaPrefs'
import { useVoice } from '../store/voice'
import { DeviceArrow } from './CallDeviceMenus'

const device = (kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo =>
  ({ kind, deviceId, label, groupId: '' }) as MediaDeviceInfo

describe('call device menus', () => {
  let switchDevice: ReturnType<typeof vi.fn>
  let setVolume: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: async () => [
          device('audioinput', 'default', 'Padrão - Microfone (Realtek)'),
          device('audioinput', 'havit', 'Headset Havit'),
          device('audiooutput', 'default', 'Padrão - Alto-falantes')
        ],
        getUserMedia: async () => {
          throw new Error('no devices in tests')
        },
        addEventListener: () => {},
        removeEventListener: () => {}
      }
    })
    switchDevice = vi.fn(async () => {})
    setVolume = vi.fn()
    useVoice.setState({ switchDevice, setVolume } as never)
  })

  it('switches the mic without leaving the call', async () => {
    render(<DeviceArrow kind="mic" />)
    fireEvent.click(screen.getByLabelText('Opções do microfone'))
    const select = (await screen.findByLabelText('Microfone')) as HTMLSelectElement
    await screen.findByText('Headset Havit')
    fireEvent.change(select, { target: { value: 'havit' } })
    expect(switchDevice).toHaveBeenCalledWith('audioinput', 'havit')
  })

  it('sets the output volume', async () => {
    render(<DeviceArrow kind="output" />)
    fireEvent.click(screen.getByLabelText('Opções do áudio'))
    fireEvent.change(await screen.findByLabelText(/Volume da chamada/), { target: { value: '150' } })
    expect(setVolume).toHaveBeenCalledWith('outputVolume', 150)
  })

  it('changes the input mode and the sensitivity from the mic menu', async () => {
    render(<DeviceArrow kind="mic" />)
    fireEvent.click(screen.getByLabelText('Opções do microfone'))
    fireEvent.click(await screen.findByText('Manual'))
    expect(loadMediaPrefs().sensitivity).toBe('manual')
    fireEvent.change(screen.getByLabelText('Sensibilidade do microfone'), { target: { value: '-40' } })
    expect(loadMediaPrefs().gateDb).toBe(-40)
    fireEvent.click(screen.getByText('Pressionar para falar'))
    expect(loadMediaPrefs().inputMode).toBe('ptt')
    expect(screen.getByText('Escolha a tecla em Configurações de voz e vídeo.')).toBeTruthy()
  })

  it('closes with Escape', async () => {
    render(<DeviceArrow kind="output" />)
    fireEvent.click(screen.getByLabelText('Opções do áudio'))
    expect(await screen.findByRole('dialog', { name: 'Opções do áudio' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Opções do áudio' })).toBeNull())
  })
})
