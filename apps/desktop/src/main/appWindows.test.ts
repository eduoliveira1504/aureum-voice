import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BrowserWindow } from 'electron'

import { CALL_FRAME_NAME } from '../shared/callWindow'
import { OVERLAY_WIDGETS } from '../shared/overlayWidgets'

const order: string[] = []

// overlay.ts needs Electron: its frame-name rule, without the rest.
vi.mock('./overlay', () => ({
  widgetOfFrame: (name: string) => /^aureum-overlay-([a-z]+)-\d+$/.exec(name)?.[1] ?? null,
  attachWindow: vi.fn(() => order.push('overlay:attach'))
}))
vi.mock('./callWindow', () => ({
  attachWindow: vi.fn(async () => order.push('call:attach'))
}))

const { adoptPopup } = await import('./appWindows')

function fakeWindow(): BrowserWindow {
  return {
    setContentProtection: vi.fn((on: boolean) => order.push(`protect:${on}`))
  } as unknown as BrowserWindow
}

describe('adoptPopup', () => {
  beforeEach(() => {
    order.length = 0
  })

  // Every floating window: the overlay's widgets and the detached call (3.24 A).
  // The voice widget also carries the overlay's notices and its "Isso é um jogo?" question.
  it.each([...OVERLAY_WIDGETS.map((w) => `aureum-overlay-${w}-1`), `${CALL_FRAME_NAME}-1`])(
    'keeps %s out of screen captures before it is taken over (and shown)',
    (frameName) => {
      const win = fakeWindow()
      adoptPopup(win, frameName)
      expect(win.setContentProtection).toHaveBeenCalledWith(true)
      expect(order[0]).toBe('protect:true')
      expect(order).toHaveLength(2)
    }
  )
})
