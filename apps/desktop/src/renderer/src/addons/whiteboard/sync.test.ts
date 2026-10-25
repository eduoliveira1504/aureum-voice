import { describe, expect, it } from 'vitest'

import { blobToDataUrl, dataUrlToBlob, followView, markKnown, takeChanged, wins } from './sync'

const el = (id: string, version: number, versionNonce = 100) => ({ id, version, versionNonce })

describe('wins', () => {
  it('takes the higher version, then the lower nonce', () => {
    expect(wins(el('a', 2), undefined)).toBe(true)
    expect(wins(el('a', 3), el('a', 2))).toBe(true)
    expect(wins(el('a', 2), el('a', 3))).toBe(false)
    expect(wins(el('a', 2, 10), el('a', 2, 50))).toBe(true)
    expect(wins(el('a', 2, 50), el('a', 2, 10))).toBe(false)
    expect(wins(el('a', 2, 10), el('a', 2, 10))).toBe(false)
  })
})

describe('takeChanged', () => {
  it('sends each change once, and never what came from elsewhere', () => {
    const known = new Map<string, number>()
    expect(takeChanged([el('a', 1), el('b', 1)], known).map((e) => e.id)).toEqual(['a', 'b'])
    expect(takeChanged([el('a', 1), el('b', 2)], known).map((e) => e.id)).toEqual(['b'])
    markKnown([el('c', 4)], known)
    expect(takeChanged([el('c', 4)], known)).toEqual([])
    expect(takeChanged([el('c', 5)], known).map((e) => e.version)).toEqual([5])
    // An older copy never lowers what's known.
    markKnown([el('c', 1)], known)
    expect(known.get('c')).toBe(5)
  })
})

describe('followView', () => {
  it('centers on what the leader sees', () => {
    // The leader sees scene x 0..800, y 0..600 at zoom 1.
    const leader = { x: 0, y: 0, width: 800, height: 600, zoom: 1 }
    const same = followView(leader, 800, 600)
    expect(same).toEqual({ scrollX: 0, scrollY: 0, zoom: 1 })
    // A canvas twice as big keeps the zoom it fits at, centered on the same point (400, 300).
    const big = followView(leader, 1600, 1200)
    expect(big.zoom).toBe(2)
    expect(1600 / (2 * big.zoom) - big.scrollX).toBe(400)
    // A narrower one zooms out so the whole width shows.
    const narrow = followView({ ...leader, x: -1000, zoom: 2 }, 400, 600)
    expect(narrow.zoom).toBe(1)
    expect(400 / 2 - narrow.scrollX).toBe(800 / 4 + 1000)
  })
})

describe('data URLs', () => {
  it('turn into bytes and back', async () => {
    const blob = dataUrlToBlob('data:image/png;base64,iVBORw0KGgo=')
    expect(blob.type).toBe('image/png')
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(await blobToDataUrl(blob)).toBe('data:image/png;base64,iVBORw0KGgo=')
  })
})
