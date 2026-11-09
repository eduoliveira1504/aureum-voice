/** Windows vs Mac (block 3.21): Cmd for Ctrl, no push-to-talk and no overlay on the Mac. */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsModal } from '../components/SettingsModal'
import { loadMediaPrefs, saveMediaPrefs } from './mediaPrefs'
import { isMac, modHeld, shortcut } from './platform'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedOut' }, logout: async () => {} })
}))

const onMac = (): void => {
  window.aureum.platform = 'darwin'
}

afterEach(() => {
  window.aureum.platform = 'win32'
  localStorage.clear()
})

describe('platform', () => {
  it('keeps Ctrl on Windows', () => {
    expect(isMac()).toBe(false)
    expect(shortcut('Ctrl+Shift+R')).toBe('Ctrl+Shift+R')
    expect(modHeld({ ctrlKey: true, metaKey: false })).toBe(true)
    expect(modHeld({ ctrlKey: false, metaKey: true })).toBe(false)
  })

  it('uses Cmd on the Mac, in what it hears and in the hints', () => {
    onMac()
    expect(shortcut('Ctrl+Shift+R')).toBe('Cmd+Shift+R')
    expect(shortcut('Ctrl K')).toBe('Cmd K')
    expect(modHeld({ ctrlKey: false, metaKey: true })).toBe(true)
    expect(modHeld({ ctrlKey: true, metaKey: false })).toBe(false)
  })

  it('never uses push-to-talk on the Mac, whatever was saved', () => {
    saveMediaPrefs({ ...loadMediaPrefs(), inputMode: 'ptt', pttKey: 'F13' })
    expect(loadMediaPrefs().inputMode).toBe('ptt')
    onMac()
    expect(loadMediaPrefs().inputMode).toBe('voice')
  })

  it('has no Overlay tab on the Mac, and a "Mac" tab for the app settings', () => {
    onMac()
    render(<SettingsModal onClose={() => {}} />)
    expect(screen.queryByRole('tab', { name: 'Overlay' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Windows' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Mac' })).toBeTruthy()
  })
})
