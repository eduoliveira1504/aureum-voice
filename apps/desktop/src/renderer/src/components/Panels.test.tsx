/** Panels on screen: the tree's dividers, dropping on edges and dividing from the header. */

import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Me, PanelLayout, ServerDetail } from '../lib/api'
import { useAppearance } from '../store/appearance'
import { layoutOf, treeOf, useNav } from '../store/nav'
import { PANEL_DRAG_TYPE, Panels } from './Panels'

vi.mock('./ChatView', () => ({ ChatView: () => <div>chat</div> }))
vi.mock('./ServerOverview', () => ({ ServerOverview: () => <div>overview</div> }))
vi.mock('./VoiceView', () => ({ VoiceView: () => <div>voice</div> }))

const SID = 's-1'
const ME = { id: 'u-me' } as Me
const channel = (id: string) => ({ id, server_id: SID, name: id, type: 'text', position: 0, addon_key: null, config: {}, overrides: [] })
const SERVER = {
  id: SID,
  name: 'Squad',
  owner_id: ME.id,
  roles: [],
  channels: ['c-1', 'c-2', 'c-3'].map(channel),
  members: [],
  voice_states: []
} as unknown as ServerDetail

const panel = (...ids: string[]) => ({ tabs: ids, active: ids[ids.length - 1] })
const setLayout = (layout: PanelLayout): void => {
  const panel_layouts: Record<string, PanelLayout> = { [SID]: layout }
  useAppearance.setState((s) => ({ settings: { ...s.settings, panel_layouts } }))
}
const show = (layout: PanelLayout): void => {
  setLayout(layout)
  render(<Panels server={SERVER} me={ME} />)
}
const region = (n: number): HTMLElement => screen.getByRole('region', { name: `Painel ${n}` })

/** Fires a drag event at a point of a 100x100 panel. */
function drag(type: 'dragOver' | 'drop', target: HTMLElement, x: number, y: number, tab: string): void {
  target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect
  const dataTransfer = { types: [PANEL_DRAG_TYPE], getData: () => JSON.stringify({ tab }) }
  const event = createEvent[type](target, { dataTransfer })
  // jsdom has no DragEvent, so the point can't go in the init.
  Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y } })
  fireEvent(target, event)
}

beforeEach(() => useNav.setState({ focusedPanel: {}, narrow: false }))
afterEach(cleanup)

describe('dividers', () => {
  it('draws one per division, in its direction', () => {
    show({
      panels: [panel('overview'), panel('channel:c-1'), panel('channel:c-2')],
      split: 0.5,
      tree: { dir: 'row', ratio: 0.5, a: 0, b: { dir: 'col', ratio: 0.5, a: 1, b: 2 } }
    })
    const dividers = screen.getAllByRole('separator', { name: 'Redimensionar painéis' })
    expect(dividers.map((d) => d.getAttribute('aria-orientation'))).toEqual(['vertical', 'horizontal'])
  })

  it('evens the sides on double click', () => {
    show({ panels: [panel('overview'), panel('channel:c-1')], split: 0.7, tree: { dir: 'row', ratio: 0.7, a: 0, b: 1 } })
    fireEvent.doubleClick(screen.getByRole('separator', { name: 'Redimensionar painéis' }))
    expect(layoutOf(SID).split).toBe(0.5)
  })
})

describe('dragging', () => {
  it('highlights where the tab would land', () => {
    show({ panels: [panel('overview', 'channel:c-1')], split: 0.5 })
    drag('dragOver', region(1), 5, 50, 'channel:c-2')
    expect(region(1).querySelector('[data-drop-zone]')?.getAttribute('data-drop-zone')).toBe('left')
    drag('dragOver', region(1), 50, 50, 'channel:c-2')
    expect(region(1).querySelector('[data-drop-zone]')?.getAttribute('data-drop-zone')).toBe('center')
  })

  it('splits on an edge and opens as a tab in the middle', () => {
    show({ panels: [panel('overview', 'channel:c-1')], split: 0.5 })
    drag('drop', region(1), 50, 95, 'channel:c-2')
    expect(treeOf(layoutOf(SID))).toEqual({ dir: 'col', ratio: 0.5, a: 0, b: 1 })
    drag('drop', region(2), 50, 50, 'channel:c-3')
    expect(layoutOf(SID).panels[1].tabs).toEqual(['channel:c-2', 'channel:c-3'])
    expect(region(1).querySelector('[data-drop-zone]')).toBeNull()
  })

  it('has no edges in a narrow window', () => {
    useNav.setState({ narrow: true })
    show({ panels: [panel('overview', 'channel:c-1')], split: 0.5 })
    drag('drop', region(1), 5, 50, 'channel:c-2')
    expect(layoutOf(SID).panels).toHaveLength(1)
  })
})

describe('Dividir', () => {
  it('moves the active tab to a new panel', () => {
    show({ panels: [panel('overview', 'channel:c-1')], split: 0.5 })
    fireEvent.click(screen.getByRole('button', { name: 'Dividir para baixo' }))
    expect(layoutOf(SID).panels.map((p) => p.tabs)).toEqual([['overview'], ['channel:c-1']])
    expect(treeOf(layoutOf(SID))).toMatchObject({ dir: 'col' })
  })

  it('is off when the panel has a single tab, and gone at four panels', () => {
    show({ panels: [panel('overview')], split: 0.5 })
    expect((screen.getByRole('button', { name: 'Dividir para o lado' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    show({ panels: [panel('overview'), panel('channel:c-1'), panel('channel:c-2'), panel('channel:c-3')], split: 0.5 })
    expect(screen.queryByRole('button', { name: 'Dividir para o lado' })).toBeNull()
  })
})
