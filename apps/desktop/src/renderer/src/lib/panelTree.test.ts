import { describe, expect, it } from 'vitest'

import type { PanelSplit } from './api'
import {
  clampRatio,
  dropEdge,
  evenRatio,
  fitPanels,
  fitRatios,
  leaves,
  matches,
  MIN_PANEL,
  minSize,
  nodeAt,
  pathBetween,
  pixels,
  placePanels,
  removePanel,
  rowOf,
  setRatio,
  splitPanel
} from './panelTree'

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

describe('placing panels', () => {
  const area = 1000

  it('fills the area with one panel', () => {
    const { panels, dividers } = placePanels(0)
    expect(dividers).toEqual([])
    expect(pixels(panels[0].box.w, area)).toBe(area)
  })

  it('shares the room left by the divider', () => {
    const { panels, dividers } = placePanels(row(0, 1, 0.25))
    const [a, b] = panels
    expect(pixels(a.box.w, area)).toBe(248)
    expect(pixels(dividers[0].box.x, area)).toBe(248)
    expect(pixels(b.box.x, area)).toBe(256)
    expect(pixels(b.box.w, area)).toBe(744)
  })

  it('nests, keeping each panel inside its division', () => {
    const { panels, dividers } = placePanels(row(0, col(1, 2)))
    expect(panels.map((p) => p.index)).toEqual([0, 1, 2])
    expect(dividers.map((d) => d.path)).toEqual(['', 'b'])
    expect(pixels(panels[2].box.x, area)).toBe(504)
    expect(pixels(panels[2].box.y, area)).toBe(504)
    expect(pixels(dividers[1].whole.w, area)).toBe(496)
  })

  it('finds a divider of a folded tree in the saved one', () => {
    const saved = row(col(0, 2), col(1, 3))
    expect(pathBetween(saved, 0, 1)).toBe('')
    expect(pathBetween(saved, 1, 3)).toBe('b')
    expect(pathBetween(saved, 2, 0)).toBe('a')
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

describe('fitting a small window', () => {
  const grid = row(col(0, 2), col(1, 3))

  it('keeps everything when it fits', () => {
    expect(fitPanels(grid, 1000, 800)).toEqual({ tree: grid, folded: {} })
  })

  it('folds as few panels as it takes, into a neighbor', () => {
    const { tree, folded } = fitPanels(grid, 1000, 300)
    expect(tree).toEqual(row(0, 1))
    expect(folded).toEqual({ 0: [2], 1: [3] })
  })

  it('moves what a folded panel held along with it', () => {
    const { tree, folded } = fitPanels(row(0, row(1, row(2, 3))), 330, 800)
    expect(tree).toBe(0)
    expect(folded).toEqual({ 0: [1, 2, 3] })
  })

  it('leaves the panels on screen where they were', () => {
    expect(fitPanels(row(0, col(1, 2)), 700, 300)).toEqual({ tree: row(0, 1), folded: { 1: [2] } })
  })
})

describe('ratios in a small window', () => {
  const widths = (tree: Parameters<typeof placePanels>[0], area: number): number[] =>
    placePanels(tree).panels.map((p) => Math.round(pixels(p.box.w, area)))

  it('leaves ratios that respect the minimum', () => {
    const tree = row(0, 1, 0.4)
    expect(fitRatios(tree, 1000, 600)).toEqual(tree)
  })

  it('raises a side under the minimum', () => {
    expect(widths(fitRatios(row(0, 1, 0.1), 1000, 600), 1000)).toEqual([320, 672])
    expect(widths(fitRatios(row(0, 1, 0.9), 1000, 600), 1000)).toEqual([672, 320])
  })

  it('handles the height the same way', () => {
    const { panels } = placePanels(fitRatios(col(0, 1, 0.05), 800, 600))
    expect(Math.round(pixels(panels[0].box.h, 600))).toBe(240)
  })

  it('reaches nested divisions, with the size they ended up with', () => {
    const tree = fitRatios(row(0, row(1, 2, 0.1), 0.1), 1100, 600)
    expect(widths(tree, 1100).every((w) => w >= 320)).toBe(true)
  })

  it('holds for what fitPanels leaves, at any size', () => {
    const grid = row(col(0, 2, 0.1), col(1, 3, 0.9), 0.15)
    for (const width of [400, 660, 700, 1000, 1400]) {
      for (const height of [250, 500, 700]) {
        const fitted = fitPanels(grid, width, height)
        const { panels } = placePanels(fitRatios(fitted.tree, width, height))
        for (const { box } of panels) {
          expect(pixels(box.w, width)).toBeGreaterThanOrEqual(MIN_PANEL.width - 0.001)
          expect(pixels(box.h, height)).toBeGreaterThanOrEqual(MIN_PANEL.height - 0.001)
        }
      }
    }
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
    expect(clampRatio(row(0, 1), 0.05, 1000)).toBeCloseTo(320 / 992)
    expect(clampRatio(row(0, 1), 0.95, 1000)).toBeCloseTo(1 - 320 / 992)
    expect(clampRatio(row(0, 1), 0.5, 1000)).toBe(0.5)
    expect(clampRatio(row(0, 1), 0.2, 500)).toBe(0.5) // no room for both
  })
})
