import { describe, expect, it } from 'vitest'

import type { PanelSplit } from './api'
import { clampRatio, dropEdge, evenRatio, leaves, matches, minSize, nodeAt, removePanel, rowOf, setRatio, splitPanel } from './panelTree'

const row = (a: PanelSplit['a'], b: PanelSplit['b'], ratio = 0.5): PanelSplit => ({ dir: 'row', ratio, a, b })
const col = (a: PanelSplit['a'], b: PanelSplit['b'], ratio = 0.5): PanelSplit => ({ dir: 'col', ratio, a, b })

describe('reading saved layouts', () => {
  it('turns panels without a tree into a row, keeping a saved split', () => {
    expect(rowOf(1)).toBe(0)
    expect(rowOf(2, 0.6)).toEqual(row(0, 1, 0.6))
    const three = rowOf(3) as PanelSplit
    expect(leaves(three)).toEqual([0, 1, 2])
    expect(three.ratio).toBeCloseTo(1 / 3)
  })

  it('notices a tree that no longer fits the panels', () => {
    const grid = row(col(0, 2), col(1, 3))
    expect(matches(grid, 4)).toBe(true)
    expect(matches(grid, 2)).toBe(false)
    expect(matches(row(0, 0), 2)).toBe(false)
    expect(matches(row(0, 2), 2)).toBe(false)
  })
})

describe('changing the tree', () => {
  it('splits a panel on each edge', () => {
    expect(splitPanel(0, 0, 'right', 1)).toEqual(row(0, 1))
    expect(splitPanel(0, 0, 'left', 1)).toEqual(row(1, 0))
    expect(splitPanel(0, 0, 'top', 1)).toEqual(col(1, 0))
    expect(splitPanel(0, 0, 'bottom', 1)).toEqual(col(0, 1))
  })

  it('builds one big panel and two stacked, and a 2x2 grid', () => {
    const bigPlusTwo = splitPanel(row(0, 1), 1, 'bottom', 2)
    expect(bigPlusTwo).toEqual(row(0, col(1, 2)))
    expect(splitPanel(bigPlusTwo, 0, 'bottom', 3)).toEqual(row(col(0, 3), col(1, 2)))
  })

  it('gives a closed panel\'s space to its neighbor and fixes the indexes', () => {
    expect(removePanel(row(0, 1), 0)).toBe(0)
    expect(removePanel(row(0, col(1, 2, 0.3), 0.7), 1)).toEqual(row(0, 1, 0.7))
    expect(removePanel(row(col(0, 3), col(1, 2)), 0)).toEqual(row(2, col(0, 1)))
  })

  it('changes one ratio by its path', () => {
    const tree = row(col(0, 2), col(1, 3))
    const next = setRatio(tree, 'b', 0.7)
    expect((nodeAt(next, 'b') as PanelSplit).ratio).toBe(0.7)
    expect((nodeAt(next, 'a') as PanelSplit).ratio).toBe(0.5)
    expect((setRatio(tree, '', 0.3) as PanelSplit).ratio).toBe(0.3)
  })
})

describe('dropping on a panel', () => {
  it('finds the edge near the pointer, and nothing in the middle', () => {
    expect(dropEdge(0.1, 0.5)).toBe('left')
    expect(dropEdge(0.9, 0.5)).toBe('right')
    expect(dropEdge(0.5, 0.1)).toBe('top')
    expect(dropEdge(0.5, 0.9)).toBe('bottom')
    expect(dropEdge(0.5, 0.5)).toBeNull()
    expect(dropEdge(0.05, 0.2)).toBe('left')
  })
})

describe('sizes', () => {
  it('evens panels along a split, not sides', () => {
    expect(evenRatio(row(0, row(1, 2)))).toBeCloseTo(1 / 3)
    expect(evenRatio(row(0, col(1, 2)))).toBe(0.5)
    expect(evenRatio(row(0, row(1, row(2, 3))))).toBe(0.25)
  })

  it('knows the smallest a node can be', () => {
    expect(minSize(0, 'row')).toBe(320)
    expect(minSize(row(0, 1), 'row')).toBe(648)
    expect(minSize(row(0, 1), 'col')).toBe(240)
  })

  it('keeps a divider from squeezing a side', () => {
    expect(clampRatio(row(0, 1), 0.05, 1000)).toBe(0.32)
    expect(clampRatio(row(0, 1), 0.95, 1000)).toBeCloseTo(0.68)
    expect(clampRatio(row(0, 1), 0.5, 1000)).toBe(0.5)
    expect(clampRatio(row(0, 1), 0.2, 500)).toBe(0.5) // no room for both
  })
})
