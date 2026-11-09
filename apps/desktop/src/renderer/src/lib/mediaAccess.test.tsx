/** macOS permissions (block 3.21): when to go ahead, and the notice when one is off. */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mayProceed, type MediaAccess } from '../../../shared/mediaAccess'
import { AccessNotice } from '../components/AccessNotice'
import { ensureAccess, useAccessNotice } from './mediaAccess'

const original = { platform: window.aureum.platform, media: window.aureum.media }

afterEach(() => {
  window.aureum.platform = original.platform
  window.aureum.media = original.media
  useAccessNotice.setState({ kind: null })
})

function onMac(access: MediaAccess): { openSettings: ReturnType<typeof vi.fn> } {
  const openSettings = vi.fn(async () => {})
  window.aureum.platform = 'darwin'
  window.aureum.media = { access: async () => access, openSettings }
  return { openSettings }
}

describe('mayProceed', () => {
  it('goes ahead when granted, and stops when denied or restricted', () => {
    expect(mayProceed('microphone', 'granted')).toBe(true)
    expect(mayProceed('camera', 'denied')).toBe(false)
    expect(mayProceed('screen', 'restricted')).toBe(false)
  })

  it('lets the screen picker make macOS ask, but not the mic or camera', () => {
    expect(mayProceed('screen', 'not-determined')).toBe(true)
    expect(mayProceed('microphone', 'not-determined')).toBe(false)
  })
})

describe('ensureAccess', () => {
  it('never asks on Windows', async () => {
    const access = vi.fn(async () => 'denied' as const)
    window.aureum.media = { access, openSettings: async () => {} }
    expect(await ensureAccess('camera')).toBe(true)
    expect(access).not.toHaveBeenCalled()
  })

  it('opens the notice when the Mac says no, with a button to the right pane', async () => {
    const { openSettings } = onMac('denied')
    render(<AccessNotice />)
    let allowed = true
    await act(async () => {
      allowed = await ensureAccess('camera')
    })
    expect(allowed).toBe(false)
    expect(screen.getByText('O Aureum não tem acesso à câmera')).toBeTruthy()
    fireEvent.click(screen.getByText('Abrir Ajustes'))
    expect(openSettings).toHaveBeenCalledWith('camera')
    expect(useAccessNotice.getState().kind).toBeNull()
  })

  it('goes ahead on the Mac when granted', async () => {
    onMac('granted')
    expect(await ensureAccess('microphone')).toBe(true)
    expect(useAccessNotice.getState().kind).toBeNull()
  })
})
