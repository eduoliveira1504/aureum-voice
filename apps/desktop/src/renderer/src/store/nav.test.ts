/** Panels of a server: the actions keep the panels, the tree and the focus in step. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '../components/ContextMenu'
import type { PanelLayout, PanelSplit } from '../lib/api'
import { useAppearance } from './appearance'
import { dividableTab, layoutOf, treeOf, useNav } from './nav'

vi.mock('../components/ContextMenu', () => ({ toast: vi.fn() }))

const SID = 's-1'
const tab = (id: number): string => `channel:c-${id}`
const nav = useNav.getState()

const setLayout = (layout: PanelLayout | null): void => {
  const panel_layouts: Record<string, PanelLayout> = layout ? { [SID]: layout } : {}
  useAppearance.setState((s) => ({ settings: { ...s.settings, panel_layouts } }))
}
const tabsOf = (): string[][] => layoutOf(SID).panels.map((p) => p.tabs)
const tree = () => treeOf(layoutOf(SID))
const focused = (): number => useNav.getState().focusedPanel[SID]

const row = (a: PanelSplit['a'], b: PanelSplit['b']): PanelSplit => ({ dir: 'row', ratio: 0.5, a, b })
const col = (a: PanelSplit['a'], b: PanelSplit['b']): PanelSplit => ({ dir: 'col', ratio: 0.5, a, b })

beforeEach(() => {
  setLayout(null)
  useNav.setState({ focusedPanel: {}, narrow: false })
  vi.mocked(toast).mockClear()
})

describe('opening panels', () => {
  it('builds 1 to 4 panels from a plain layout', () => {
    expect(tree()).toBe(0)
    nav.dropTab(SID, tab(1), 0, 'right')
    expect(tree()).toEqual(row(0, 1))
    nav.dropTab(SID, tab(2), 1, 'bottom')
    expect(tree()).toEqual(row(0, col(1, 2)))
    nav.dropTab(SID, tab(3), 0, 'bottom')
    expect(tree()).toEqual(row(col(0, 3), col(1, 2)))
    expect(tabsOf()).toEqual([['overview'], [tab(1)], [tab(2)], [tab(3)]])
    expect(focused()).toBe(3)
    expect(toast).not.toHaveBeenCalled()
  })

  it('opens a 5th as a tab of the panel, and says why', () => {
    nav.dropTab(SID, tab(1), 0, 'right')
    nav.dropTab(SID, tab(2), 0, 'right')
    nav.dropTab(SID, tab(3), 0, 'right')
    nav.dropTab(SID, tab(4), 2, 'left')
    expect(toast).toHaveBeenCalledWith('Máximo de 4 painéis')
    expect(tabsOf()).toHaveLength(4)
    expect(tabsOf()[2]).toContain(tab(4))
    expect(focused()).toBe(2)
  })

  it('can still rearrange a full layout with a panel of one tab', () => {
    nav.dropTab(SID, tab(1), 0, 'right')
    nav.dropTab(SID, tab(2), 0, 'right')
    nav.dropTab(SID, tab(3), 0, 'right')
    nav.dropTab(SID, tab(3), 1, 'bottom')
    expect(toast).not.toHaveBeenCalled()
    expect(tabsOf()).toHaveLength(4)
    expect(treeOf(layoutOf(SID))).toMatchObject({ dir: 'row' })
  })

  it('opens beside the panel in focus with openTab', () => {
    nav.openTab(SID, tab(1))
    nav.openTab(SID, tab(2), true)
    expect(tabsOf()).toEqual([['overview', tab(1)], [tab(2)]])
    expect(tree()).toEqual(row(0, 1))
  })

  it('stays in one panel in a narrow window, without a warning', () => {
    useNav.setState({ narrow: true })
    nav.dropTab(SID, tab(1), 0, 'right')
    expect(tabsOf()).toEqual([['overview', tab(1)]])
    expect(toast).not.toHaveBeenCalled()
  })

  it('moves a tab that is already open, instead of repeating it', () => {
    nav.openTab(SID, tab(1))
    nav.dropTab(SID, tab(1), 0, 'right')
    expect(tabsOf()).toEqual([['overview'], [tab(1)]])
  })

  it('only activates a tab dropped back on its own panel', () => {
    nav.openTab(SID, tab(1))
    nav.openTab(SID, tab(2))
    nav.dropTab(SID, tab(1), 0)
    expect(tabsOf()).toEqual([['overview', tab(1), tab(2)]])
    expect(layoutOf(SID).panels[0].active).toBe(tab(1))
  })

  it('keeps the overview pinned, even with a panel to its left', () => {
    nav.dropTab(SID, tab(1), 0, 'left')
    expect(tree()).toEqual(row(1, 0))
    nav.dropTab(SID, 'overview', 1)
    expect(tabsOf()[0]).toEqual(['overview'])
  })

  it('ignores splitting a panel with its only tab', () => {
    nav.dropTab(SID, tab(1), 0, 'right')
    nav.dropTab(SID, tab(1), 1, 'bottom')
    expect(tree()).toEqual(row(0, 1))
  })
})

describe('closing', () => {
  beforeEach(() => {
    nav.dropTab(SID, tab(1), 0, 'right')
    nav.dropTab(SID, tab(2), 1, 'bottom')
    nav.dropTab(SID, tab(3), 0, 'bottom')
  })

  it('gives the space to the neighbor', () => {
    nav.closePanel(SID, 1)
    expect(tree()).toEqual(row(col(0, 2), 1))
    expect(tabsOf()).toEqual([['overview'], [tab(2)], [tab(3)]])
  })

  it('drops the panel of a last closed tab, or of a moved one', () => {
    nav.closeTab(SID, 2, tab(2))
    expect(tree()).toEqual(row(col(0, 2), 1))
    nav.dropTab(SID, tab(1), 0)
    expect(tree()).toEqual(col(0, 1))
    expect(focused()).toBe(0)
  })

  it('keeps the overview when its own panel closes', () => {
    nav.closePanel(SID, 0)
    expect(tabsOf()[0]).toEqual(['overview', tab(1)])
    expect(tabsOf()).toHaveLength(3)
  })

  it('removes a deleted channel from wherever it is', () => {
    nav.dropChannelTab(SID, 'c-2')
    expect(tree()).toEqual(row(col(0, 2), 1))
  })
})

describe('sizes', () => {
  it('saves a divider, and mirrors the root for older apps', () => {
    nav.dropTab(SID, tab(1), 0, 'right')
    nav.setPanelRatio(SID, '', 0.7)
    expect(layoutOf(SID)).toMatchObject({ split: 0.7, tree: { ratio: 0.7 } })
  })

  it('evens three columns', () => {
    nav.dropTab(SID, tab(1), 0, 'right')
    nav.dropTab(SID, tab(2), 1, 'right')
    nav.evenPanels(SID, '')
    expect((tree() as PanelSplit).ratio).toBeCloseTo(1 / 3)
  })
})

describe('dividableTab', () => {
  const panel = (tabs: string[], active: string) => ({ tabs, active })

  it('takes the active tab', () => {
    expect(dividableTab(panel(['overview', tab(1), tab(2)], tab(1)))).toBe(tab(1))
  })

  it('takes the last tab when the overview is active', () => {
    expect(dividableTab(panel(['overview', tab(1), tab(2)], 'overview'))).toBe(tab(2))
  })

  it('has nothing to give with a single tab', () => {
    expect(dividableTab(panel(['overview'], 'overview'))).toBeNull()
    expect(dividableTab(panel([tab(1)], tab(1)))).toBeNull()
  })
})

describe('saved layouts', () => {
  const OLD: PanelLayout = {
    panels: [
      { tabs: ['overview'], active: 'overview' },
      { tabs: [tab(1)], active: tab(1) }
    ],
    split: 0.6
  }

  it('keeps a layout of two panels as it was', () => {
    setLayout(OLD)
    expect(tree()).toEqual({ dir: 'row', ratio: 0.6, a: 0, b: 1 })
  })

  it('rebuilds a tree that an older app left behind', () => {
    setLayout({ ...OLD, tree: row(col(0, 2), 1) })
    expect(tree()).toEqual({ dir: 'row', ratio: 0.6, a: 0, b: 1 })
    nav.dropTab(SID, tab(2), 1, 'bottom')
    expect(tabsOf()).toHaveLength(3)
  })
})
