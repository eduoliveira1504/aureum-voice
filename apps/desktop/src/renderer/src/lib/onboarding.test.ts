/** Tour rules (block 3.16): who gets it, which steps, and where the balloon goes. */

import { describe, expect, it } from 'vitest'

import { balloonPosition, tourDone, tourStart, tourSteps, withTipSeen } from './onboarding'

const fresh = { tour_version_done: 0, tour_invite: false, tips_seen: [] }

describe('when the tour starts', () => {
  it('starts by itself on a new account', () => {
    expect(tourStart(fresh, 1)).toEqual({ kind: 'auto' })
  })
  it('asks first on an account older than the tour', () => {
    expect(tourStart({ ...fresh, tour_invite: true }, 1)).toEqual({ kind: 'invite' })
  })
  it('stays away once done, skipped or declined', () => {
    expect(tourStart(tourDone({ ...fresh, tour_invite: true }, 1), 1)).toEqual({ kind: 'none' })
  })
  it('shows only the new steps after the tour grows', () => {
    expect(tourStart({ ...fresh, tour_version_done: 1 }, 2)).toEqual({ kind: 'news', since: 1 })
  })
})

describe('the steps', () => {
  const steps = [
    { id: 'hello', since: 1 },
    { id: 'server', since: 1, needsServer: true },
    { id: 'later', since: 2 }
  ]
  it('drops the server steps without a server', () => {
    expect(tourSteps(steps, { hasServer: false }).map((s) => s.id)).toEqual(['hello', 'later'])
  })
  it('keeps only the steps newer than the version done', () => {
    expect(tourSteps(steps, { since: 1, hasServer: true }).map((s) => s.id)).toEqual(['later'])
  })
})

describe('tips', () => {
  it('are saved once', () => {
    const once = withTipSeen(fresh, 'call.controls')
    expect(withTipSeen(once, 'call.controls')).toBe(once)
    expect(once.tips_seen).toEqual(['call.controls'])
  })
})

describe('the balloon', () => {
  const size = { width: 300, height: 150 }
  const view = { width: 1200, height: 800 }
  it('goes below the element, centered on it', () => {
    expect(balloonPosition({ left: 500, top: 10, width: 200, height: 40 }, size, view)).toEqual({ left: 450, top: 64, side: 'bottom' })
  })
  it('goes above when there is no room below', () => {
    expect(balloonPosition({ left: 500, top: 700, width: 200, height: 40 }, size, view).side).toBe('top')
  })
  it('never leaves the window', () => {
    const pos = balloonPosition({ left: 1150, top: 10, width: 40, height: 40 }, size, view)
    expect(pos.left + size.width).toBeLessThanOrEqual(view.width - 12)
  })
  it('sits beside an element as tall as the window', () => {
    expect(balloonPosition({ left: 0, top: 0, width: 280, height: 800 }, size, view).side).toBe('right')
  })
  it('is centered without an element', () => {
    expect(balloonPosition(null, size, view)).toEqual({ left: 450, top: 325, side: 'center' })
  })
})
