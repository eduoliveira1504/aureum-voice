/** Panels on screen: the tree's dividers, dropping on edges and dividing from the header. */

import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Me, PanelLayout, PanelSplit, ServerDetail } from '../lib/api'
import { useAppearance } from '../store/appearance'
import { layoutOf, treeOf, useNav } from '../store/nav'
import { useVoice } from '../store/voice'
import { ContextMenuHost } from './ContextMenu'
import { PANEL_DRAG_TYPE, Panels } from './Panels'

const mounts = vi.hoisted(() => ({ chat: {} as Record<string, number>, voice: 0 }))

vi.mock('./ChatView', async () => {
  const { useEffect } = await import('react')
  return {
    ChatView: ({ channel }: { channel: { id: string } }) => {
      useEffect(() => {
        mounts.chat[channel.id] = (mounts.chat[channel.id] ?? 0) + 1
      }, [channel.id])
      return <div data-testid={`chat-${channel.id}`}>chat</div>
    }
  }
})
vi.mock('./ServerOverview', () => ({ ServerOverview: () => <div>overview</div> }))
vi.mock('./VoiceView', async () => {
  const { useEffect } = await import('react')
  return {
    VoiceView: () => {
      useEffect(() => void mounts.voice++, [])
      return <video data-testid="video" />
    }
  }
})

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

beforeEach(() => useNav.setState({ focusedPanel: {}, narrow: false, maximized: {} }))
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

describe('tab order', () => {
  const tabAt = (name: string, left: number): void => {
    screen.getByRole('tab', { name }).getBoundingClientRect = () => ({ left, width: 100 }) as DOMRect
  }
  const strip = (): HTMLElement => screen.getByRole('tablist')

  beforeEach(() => {
    show({ panels: [panel('overview', 'channel:c-1', 'channel:c-2')], split: 0.5 })
    tabAt('Visão geral', 0)
    tabAt('c-1', 100)
    tabAt('c-2', 200)
  })

  it('shows a line where the tab would go, and drops it there', () => {
    drag('dragOver', strip(), 110, 5, 'channel:c-2')
    expect(region(1).querySelector('[data-tab-line]')).not.toBeNull()
    expect(region(1).querySelector('[data-drop-zone]')).toBeNull()
    drag('drop', strip(), 110, 5, 'channel:c-2')
    expect(layoutOf(SID).panels[0].tabs).toEqual(['overview', 'channel:c-2', 'channel:c-1'])
    expect(region(1).querySelector('[data-tab-line]')).toBeNull()
  })

  it('never goes before the overview', () => {
    drag('drop', strip(), 5, 5, 'channel:c-2')
    expect(layoutOf(SID).panels[0].tabs).toEqual(['overview', 'channel:c-2', 'channel:c-1'])
  })

  it('offers only the moves that exist', () => {
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'c-1' }))
    render(<ContextMenuHost />)
    expect(screen.queryByText('Mover para a esquerda')).toBeNull()
    fireEvent.click(screen.getByText('Mover para a direita'))
    expect(layoutOf(SID).panels[0].tabs).toEqual(['overview', 'channel:c-2', 'channel:c-1'])
  })
})

describe('maximizing', () => {
  const TWO: PanelLayout = { panels: [panel('overview'), panel('channel:c-1')], split: 0.5 }

  beforeEach(() => useNav.setState({ maximized: {}, membersDrawer: null }))

  it('fills the area on a double click on the header, and comes back', () => {
    show(TWO)
    fireEvent.doubleClick(within(region(2)).getByTestId('panel-header'))
    expect(screen.queryByRole('region', { name: 'Painel 1' })).toBeNull()
    expect(screen.queryByRole('separator', { name: 'Redimensionar painéis' })).toBeNull()
    fireEvent.doubleClick(within(region(2)).getByTestId('panel-header'))
    expect(region(1)).toBeTruthy()
  })

  it('leaves double clicks on the header buttons alone', () => {
    show(TWO)
    fireEvent.doubleClick(within(region(2)).getByRole('button', { name: 'Dividir para o lado' }))
    expect(region(1)).toBeTruthy()
  })

  it('comes back with Esc or the button', () => {
    show(TWO)
    act(() => useNav.getState().toggleMaximize(SID, 0))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(region(2)).toBeTruthy()
    act(() => useNav.getState().toggleMaximize(SID, 0))
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao layout' }))
    expect(region(2)).toBeTruthy()
  })

  it('leaves Esc to what is over it, and to text fields', () => {
    render(<input aria-label="campo" />)
    show(TWO)
    act(() => useNav.getState().toggleMaximize(SID, 0))
    fireEvent.keyDown(screen.getByLabelText('campo'), { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Painel 2' })).toBeNull()
    act(() => useNav.setState({ membersDrawer: SID }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Painel 2' })).toBeNull()
  })
})

describe('small windows', () => {
  const FOUR: PanelLayout = {
    panels: [panel('overview'), panel('channel:c-1'), panel('channel:c-2'), panel('channel:c-3')],
    split: 0.5,
    tree: { dir: 'row', ratio: 0.5, a: { dir: 'col', ratio: 0.5, a: 0, b: 2 }, b: { dir: 'col', ratio: 0.5, a: 1, b: 3 } }
  }
  let resize: () => void

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe(): void {}
      disconnect(): void {}
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const windowOf = (width: number, height: number): void => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height)
    act(() => resize())
  }

  it('turns panels that do not fit into tabs, and brings them back', () => {
    show(FOUR)
    windowOf(1000, 300)
    expect(screen.queryByRole('region', { name: 'Painel 3' })).toBeNull()
    expect(within(region(1)).getByRole('tab', { name: 'c-2' })).toBeTruthy()
    expect(layoutOf(SID).panels).toHaveLength(4)
    windowOf(1000, 800)
    expect(region(3)).toBeTruthy()
    expect(within(region(1)).queryByRole('tab', { name: 'c-2' })).toBeNull()
  })

  it('shows a folded tab when picked, on its own panel', () => {
    show(FOUR)
    windowOf(1000, 300)
    fireEvent.click(within(region(1)).getByRole('tab', { name: 'c-2' }))
    expect(useNav.getState().focusedPanel[SID]).toBe(2)
    expect(region(3)).toBeTruthy()
    expect(within(region(3)).getByRole('tab', { name: 'c-2' }).getAttribute('aria-selected')).toBe('true')
    expect(useNav.getState().shownPanels[SID]).toEqual([2, 1])
  })

  it('adjusts a saved ratio on screen and leaves it saved', () => {
    show({ panels: [panel('overview'), panel('channel:c-1')], split: 0.2, tree: { dir: 'row', ratio: 0.1, a: 0, b: 1 } })
    windowOf(1000, 600)
    const divider = screen.getByRole('separator', { name: 'Redimensionar painéis' })
    // 320px of 992 available, not the saved 10%.
    expect(divider.style.left).toContain(`${(320 / 992) * 100}`.slice(0, 5))
    expect(treeOf(layoutOf(SID))).toMatchObject({ ratio: 0.1 })
  })

  it('saves a divider in its place in the full tree while panels are folded', () => {
    show(FOUR)
    windowOf(1000, 300)
    fireEvent.doubleClick(screen.getByRole('separator', { name: 'Redimensionar painéis' }))
    expect(treeOf(layoutOf(SID))).toMatchObject({ a: { ratio: 0.5 }, b: { ratio: 0.5 } })
    expect((treeOf(layoutOf(SID)) as PanelSplit).dir).toBe('row')
  })

  it('reports what is on screen, for the floating call', () => {
    show(FOUR)
    expect(useNav.getState().shownPanels[SID]).toEqual([0, 2, 1, 3])
    act(() => useNav.getState().toggleMaximize(SID, 1))
    expect(useNav.getState().shownPanels[SID]).toEqual([1])
  })
})

describe('neighbors of a change', () => {
  const nav = useNav.getState()

  beforeEach(() => {
    mounts.chat = {}
    mounts.voice = 0
    useVoice.setState({ phase: 'connected', serverId: SID, channelId: 'c-3' } as never)
    show({ panels: [{ tabs: ['overview', 'channel:c-2'], active: 'overview' }, panel('channel:c-1'), panel('call')], split: 0.5 })
  })
  afterEach(() => useVoice.setState({ phase: 'idle', serverId: null, channelId: null }))

  /** Runs `change` and checks that the chat and the call came through it untouched. */
  function untouched(change: () => void): void {
    const chat = screen.getByTestId('chat-c-1')
    const video = screen.getByTestId('video')
    chat.scrollTop = 120
    const area = chat.closest('section')!.parentElement!
    const moves = new MutationObserver(() => {})
    moves.observe(area, { childList: true })

    act(change)

    expect(screen.getByTestId('chat-c-1')).toBe(chat)
    expect(screen.getByTestId('video')).toBe(video)
    expect(chat.scrollTop).toBe(120)
    expect(mounts.chat['c-1']).toBe(1)
    expect(mounts.voice).toBe(1)
    // Taking a node out and back in would restart the video, even with the same element.
    const gone = moves.takeRecords().flatMap((r) => [...r.removedNodes])
    expect(gone.some((n) => n.contains(chat) || n.contains(video))).toBe(false)
    moves.disconnect()
  }

  it('keeps them when another panel is divided', () => {
    untouched(() => nav.dropTab(SID, 'channel:c-2', 0, 'bottom'))
  })

  it('keeps them when a panel opens on an edge of theirs', () => {
    untouched(() => nav.dropTab(SID, 'channel:c-2', 1, 'left'))
    expect(treeOf(layoutOf(SID))).toMatchObject({ dir: 'row' })
  })

  it('keeps them when a panel next to them closes', () => {
    untouched(() => nav.dropTab(SID, 'channel:c-2', 0, 'bottom'))
    untouched(() => nav.closePanel(SID, 3))
  })

  it('keeps them when a panel before them closes and their indexes change', () => {
    untouched(() => nav.closePanel(SID, 0))
    expect(layoutOf(SID).panels[0].tabs).toEqual(['overview', 'channel:c-1'])
  })

  it('keeps them when another device swaps the panels around', () => {
    const layout = layoutOf(SID)
    untouched(() => setLayout({ ...layout, tree: { dir: 'row', ratio: 0.5, a: 2, b: { dir: 'col', ratio: 0.5, a: 1, b: 0 } } }))
  })

  it('keeps them when a panel opens beside the call', () => {
    untouched(() => nav.dropTab(SID, 'channel:c-2', 2, 'right'))
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
