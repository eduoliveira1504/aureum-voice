/** The top bar's update button: "Reiniciar" on Windows, "Baixar a versão X" on the Mac (3.21). */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { UpdateState } from '../../../shared/types'
import { UpdateButton } from './TopBar'

const original = window.aureum.updates

afterEach(() => {
  window.aureum.updates = original
})

function mockUpdates(state: UpdateState): { install: ReturnType<typeof vi.fn> } {
  const install = vi.fn(async () => {})
  window.aureum.updates = { getState: async () => state, install, onReady: () => () => {} }
  return { install }
}

describe('UpdateButton', () => {
  it('stays hidden with nothing new', async () => {
    mockUpdates({ ready: false, version: null })
    const { container } = render(<UpdateButton />)
    await act(async () => {})
    expect(container.textContent).toBe('')
  })

  it('offers a restart once an update downloaded (Windows)', async () => {
    const { install } = mockUpdates({ ready: true, version: '0.2.0-beta.11' })
    render(<UpdateButton />)
    fireEvent.click(await screen.findByText('Reiniciar para atualizar'))
    expect(install).toHaveBeenCalledOnce()
  })

  it('offers the download page for a newer version on the Mac', async () => {
    const { install } = mockUpdates({ ready: true, version: '0.2.0-beta.11', manual: true })
    render(<UpdateButton />)
    fireEvent.click(await screen.findByText('Baixar a versão 0.2.0-beta.11'))
    expect(install).toHaveBeenCalledOnce()
    expect(screen.queryByText('Reiniciar para atualizar')).toBeNull()
  })
})
