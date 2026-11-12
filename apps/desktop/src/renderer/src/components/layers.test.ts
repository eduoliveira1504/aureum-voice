/** Block 4.1.1: one layer scale (main.css), and no z-index outside it. */

import { describe, expect, it } from 'vitest'

import { LAYERS } from '../test/layers'

const files = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../test/**'], {
  query: '?raw',
  import: 'default',
  eager: true
})

const ORDER = ['raised', 'drawer', 'float', 'shell', 'viewer', 'modal', 'dialog', 'popover', 'tooltip', 'tip', 'toast', 'tour']

describe('layer scale', () => {
  it('goes from content up to the tour, in this order', () => {
    expect(Object.keys(LAYERS).sort((a, b) => LAYERS[a] - LAYERS[b])).toEqual(ORDER)
  })

  it('puts menus over modals and over the dialogs menus open', () => {
    expect(LAYERS.popover).toBeGreaterThan(LAYERS.dialog)
    expect(LAYERS.dialog).toBeGreaterThan(LAYERS.modal)
  })

  it('is the only z-index in components (no bare numbers, arbitrary values or inline zIndex)', () => {
    const bare: string[] = []
    for (const [file, code] of Object.entries(files)) {
      for (const [match] of code.matchAll(/\bz-(?:\d+|\[[^\]]*\])|zIndex/g)) bare.push(`${file}: ${match}`)
      for (const [, name] of code.matchAll(/\bz-([a-z]+)\b/g)) if (!(name in LAYERS)) bare.push(`${file}: z-${name}`)
    }
    expect(bare).toEqual([])
  })
})
