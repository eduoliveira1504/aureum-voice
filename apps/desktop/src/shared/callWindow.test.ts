import { describe, expect, it } from 'vitest'

import {
  CALL_WINDOW_DEFAULT,
  CALL_WINDOW_MIN,
  cleanCallBounds,
  cleanCallWindowPrefs,
  defaultCallBounds,
  isCallFrame,
  restoreCallBounds
} from './callWindow'

const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const second = { x: 1920, y: 0, width: 1280, height: 984 }

describe('detached call window', () => {
  it('lets only the call window name through', () => {
    expect(isCallFrame('aureum-call-1731000000000')).toBe(true)
    expect(isCallFrame('aureum-call-')).toBe(false)
    expect(isCallFrame('aureum-overlay-voice-1')).toBe(false)
    expect(isCallFrame('aureum-call-1-x')).toBe(false)
  })

  it('opens at the bottom-right of the main monitor the first time', () => {
    const box = restoreCallBounds(null, [primary, second], primary)
    expect(box).toEqual(defaultCallBounds(primary))
    expect(box.width).toBe(CALL_WINDOW_DEFAULT.width)
    expect(box.x + box.width).toBeLessThan(primary.width)
    expect(box.y + box.height).toBeLessThan(primary.height)
  })

  it('reopens where it was, on the monitor it was on', () => {
    const saved = { x: 2400, y: 100, width: 500, height: 300 }
    expect(restoreCallBounds(saved, [primary, second], primary)).toEqual(saved)
  })

  it('goes back to the main monitor when its monitor is gone', () => {
    const saved = { x: 2400, y: 100, width: 500, height: 300 }
    expect(restoreCallBounds(saved, [primary], primary)).toEqual(defaultCallBounds(primary))
  })

  it('stays inside the monitor, smaller if it no longer fits', () => {
    const saved = { x: 1500, y: -50, width: 3000, height: 400 }
    // Its center (3000, 150) is on the second monitor, which is narrower than it.
    expect(restoreCallBounds(saved, [primary, second], primary)).toEqual({ x: 1920, y: 0, width: 1280, height: 400 })
  })

  it('reads a saved file defensively', () => {
    expect(cleanCallWindowPrefs(null)).toEqual({ bounds: null, pinned: true })
    expect(cleanCallWindowPrefs({ pinned: false, bounds: { x: 1.4, y: 2, width: 10, height: 10 } })).toEqual({
      pinned: false,
      bounds: { x: 1, y: 2, width: CALL_WINDOW_MIN.width, height: CALL_WINDOW_MIN.height }
    })
    expect(cleanCallBounds({ x: 'a', y: 0, width: 300, height: 200 })).toBeNull()
    expect(cleanCallBounds({ x: 1e9, y: 0, width: 300, height: 200 })).toBeNull()
  })
})
