/** Block 4.1.4: an update is hard to miss, never installs by itself, and is offered even when the
 * updater failed (the API says which version is out). */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { UpdateState } from '../../../shared/types'
import { DELIVERY_GRACE_MS, offerFor, resetUpdateBarForTests, UpdateBar } from './UpdateBar'

const NONE: UpdateState = { ready: false, version: null }
let pushState: (state: UpdateState) => void = () => {}

beforeEach(() => {
  resetUpdateBarForTests()
  window.aureum.app.info = async () => ({ version: '0.2.0-beta.10', os: 'Windows' })
  window.aureum.updates.getState = async () => NONE
  window.aureum.updates.onReady = (listener) => {
    pushState = listener
    return () => {}
  }
  window.aureum.updates.install = vi.fn(async () => {})
  window.aureum.updates.check = vi.fn(async () => {})
})
afterEach(() => vi.restoreAllMocks())

function latestIs(version: string | null): void {
  vi.spyOn(api, 'api').mockImplementation(async (path) => {
    if (path === '/public/latest-version') return { version }
    throw new Error(`unexpected ${path}`)
  })
}

async function shown(): Promise<void> {
  render(<UpdateBar />)
  await act(async () => {})
}

describe('update bar', () => {
  it('a downloaded update shows "Reiniciar agora", and only installs on click', async () => {
    latestIs('0.2.0-beta.11')
    await shown()
    act(() => pushState({ ready: true, version: '0.2.0-beta.11' }))
    expect(screen.getByRole('status', { name: 'Atualização do Aureum' }).textContent).toContain('0.2.0-beta.11')
    expect(window.aureum.updates.install).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar agora' }))
    expect(window.aureum.updates.install).toHaveBeenCalledOnce()
  })

  it('"Depois" hides it until the app opens again', async () => {
    latestIs('0.2.0-beta.11')
    window.aureum.updates.getState = async () => ({ ready: true, version: '0.2.0-beta.11' })
    const { unmount } = render(<UpdateBar />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Depois' }))
    expect(screen.queryByRole('status', { name: 'Atualização do Aureum' })).toBeNull()
    unmount()
    await shown() // the same run (e.g. signing in again): still hidden
    expect(screen.queryByRole('status', { name: 'Atualização do Aureum' })).toBeNull()
  })

  it('with the updater failing, the API version brings "Baixar agora" (and asks the updater to try)', async () => {
    latestIs('0.2.0-beta.11')
    window.aureum.updates.getState = async () => ({ ready: false, version: null, failed: true })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await shown()
    expect(window.aureum.updates.check).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Baixar agora' }))
    expect(open).toHaveBeenCalledWith(expect.stringContaining('#baixar'))
  })

  it('shows nothing when this is the newest version', async () => {
    latestIs('0.2.0-beta.10')
    window.aureum.updates.getState = async () => ({ ready: false, version: null, failed: true })
    await shown()
    expect(screen.queryByRole('status', { name: 'Atualização do Aureum' })).toBeNull()
    expect(window.aureum.updates.check).not.toHaveBeenCalled()
  })
})

describe('what the bar offers', () => {
  const latest = { version: '0.2.0-beta.11', seenAt: 0 }

  it('waits a while for the updater before falling back to the download page', () => {
    expect(offerFor(NONE, '0.2.0-beta.10', latest, DELIVERY_GRACE_MS - 1)).toBeNull()
    expect(offerFor(NONE, '0.2.0-beta.10', latest, DELIVERY_GRACE_MS)).toEqual({ kind: 'download', version: '0.2.0-beta.11' })
  })

  it('on the Mac, a newer version is always a download', () => {
    expect(offerFor({ ready: true, version: '0.2.0-beta.11', manual: true }, '0.2.0-beta.10', null, 0)).toEqual({
      kind: 'download',
      version: '0.2.0-beta.11'
    })
  })

  it('without the API, an older installed version offers nothing extra', () => {
    expect(offerFor({ ...NONE, failed: true }, '0.2.0-beta.10', null, 0)).toBeNull()
  })
})
