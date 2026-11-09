/**
 * The tour and the tips find elements by fixed anchors (data-tour="..."). This fails when an
 * anchor they use is no longer in the app, so a layout change can't break the tour silently.
 */

import { describe, expect, it } from 'vitest'

import { TOUR_STEPS } from './tourSteps'

const files = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true })

/** Every data-tour="..." written in the app's components. */
const anchorsInApp = new Set(Object.values(files).flatMap((source) => [...source.matchAll(/data-tour="([a-z0-9.-]+)"/g)].map((m) => m[1])))

describe('tour anchors', () => {
  it('finds the app sources', () => {
    expect(Object.keys(files).length).toBeGreaterThan(50)
  })

  it.each(TOUR_STEPS.filter((s) => s.anchor).map((s) => [s.id, s.anchor!]))('step %s finds data-tour="%s"', (_, anchor) => {
    expect(anchorsInApp).toContain(anchor)
  })
})
