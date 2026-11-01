import { create } from 'zustand'

import { toast } from '../components/ContextMenu'
import type { Panel, PanelLayout, PanelNode, PanelTab } from '../lib/api'
import { evenRatio, matches, nodeAt, removePanel, rowOf, setRatio, splitPanel, type Edge, type TreePath } from '../lib/panelTree'
import { useAppearance } from './appearance'
import { useVoice } from './voice'

/**
 * Where the user is in the app shell: the Home tab or a server tab, and inside a server, which
 * panels are open. Tab order, closed tabs, the sidebar state and panel layouts live in the
 * user's settings (synced to every PC); the rest is per window.
 */

export type Place = 'home' | string // 'home' or a server id
/** What the Home tab shows: the hub, the friends list or a conversation (DM or group id). */
export type HomePage = 'hub' | 'friends' | string
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export const MAX_PANELS = 4
export const DEFAULT_LAYOUT: PanelLayout = { panels: [{ tabs: ['overview'], active: 'overview' }], split: 0.5 }

export type TabRef =
  | { kind: 'overview' }
  | { kind: 'call' }
  | { kind: 'channel'; id: string }

export const channelTab = (id: string): PanelTab => `channel:${id}`

export function parseTab(tab: PanelTab): TabRef {
  if (tab.startsWith('channel:')) return { kind: 'channel', id: tab.slice('channel:'.length) }
  return { kind: tab === 'call' ? 'call' : 'overview' }
}

/** A panel's tabs without `tab`; keeps a sensible active tab. */
function without(panel: Panel, tab: PanelTab): Panel {
  const index = panel.tabs.indexOf(tab)
  const tabs = panel.tabs.filter((t) => t !== tab)
  const active = panel.active === tab ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : panel.active
  return { tabs, active }
}

/** Placeholder addon tabs from before addons were channels (`addon:<key>`). */
const isLegacyTab = (tab: PanelTab): boolean => tab.startsWith('addon:')

/**
 * The overview is pinned: always the first tab of the first panel, and nowhere else. Also fixes
 * layouts saved before it was pinned, and drops the old addon placeholder tabs.
 */
export function pinOverview(saved: PanelLayout): PanelLayout {
  const layout = { ...saved, panels: saved.panels.map((p) => p.tabs.filter(isLegacyTab).reduce(without, p)) }
  const [first, ...rest] = layout.panels
  const others = rest.map((p) => without(p, 'overview')).filter((p) => p.tabs.length > 0)
  const tabs = ['overview', ...(first?.tabs ?? []).filter((t) => t !== 'overview')]
  const moved = rest.some((p) => p.active === 'overview')
  const active = moved ? 'overview' : (first?.active ?? 'overview')
  return { ...layout, panels: [{ tabs, active }, ...others] }
}

export function layoutOf(serverId: string): PanelLayout {
  const saved = useAppearance.getState().settings.panel_layouts[serverId]
  return pinOverview(saved?.panels.length ? saved : DEFAULT_LAYOUT)
}

/** Where a layout's panels go; panels saved without a tree, or by an older app, sit in a row. */
export function treeOf(layout: PanelLayout): PanelNode {
  return layout.tree && matches(layout.tree, layout.panels.length) ? layout.tree : rowOf(layout.panels.length, layout.split)
}

/** The tab "Dividir" moves to a new panel; none if the panel would be left empty. */
export function dividableTab(panel: Panel): PanelTab | null {
  const movable = panel.tabs.filter((t) => t !== 'overview')
  if (!movable.length || panel.tabs.length === 1) return null
  return panel.active && movable.includes(panel.active) ? panel.active : movable[movable.length - 1]
}

/** Sets the tree, and the split older apps read: the root's ratio, within what they accept. */
function withTree(layout: PanelLayout, tree: PanelNode): PanelLayout {
  if (typeof tree === 'number') return { ...layout, tree: null }
  const split = tree.dir === 'row' ? Math.min(0.8, Math.max(0.2, tree.ratio)) : layout.split
  return { ...layout, tree, split }
}

/** Whether the server's member bar is open. Until it's chosen, a layout saved when the list was
 * per tab opens it if any tab had the list. */
export function membersBarOpen(layout: PanelLayout | undefined): boolean {
  return layout?.members_open ?? !!layout?.members?.length
}

/** The tab of the panel in focus. */
export function focusedTab(layout: PanelLayout, focused: number): PanelTab | null {
  return layout.panels[Math.min(focused, layout.panels.length - 1)]?.active ?? null
}

/** The panels on screen: all of them, or only the focused one in a narrow window. */
export function visiblePanels(layout: PanelLayout, focused: number, narrow: boolean): number[] {
  const all = layout.panels.map((_, i) => i)
  return narrow && all.length > 1 ? [Math.min(focused, all.length - 1)] : all
}

/** Server tabs in the top bar: the user's order first, then servers joined since, minus closed ones. */
export function serverTabs(order: string[], tabOrder: string[], closed: string[]): string[] {
  const joined = new Set(order)
  const hidden = new Set(closed)
  const ordered = tabOrder.filter((id) => joined.has(id))
  const rest = order.filter((id) => !ordered.includes(id))
  return [...ordered, ...rest].filter((id) => !hidden.has(id))
}

const PIP_KEY = 'aureum.pip'

function loadPip(): { corner: Corner } {
  try {
    const corner = JSON.parse(localStorage.getItem(PIP_KEY) ?? '{}').corner
    if (['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(corner)) return { corner }
  } catch {
    // Storage unavailable: default corner.
  }
  return { corner: 'bottom-right' }
}

interface NavState {
  place: Place
  homePage: HomePage
  /** Panel that receives tabs opened with a plain click, per server. */
  focusedPanel: Record<string, number>
  pipMinimized: boolean
  pipCorner: Corner
  callFullscreen: boolean
  /** Window below ~1100px: sidebar shows icons only and a single panel. */
  narrow: boolean
  /** Panels really on screen, per server, as the panel area worked them out. */
  shownPanels: Record<string, number[]>
  /** Panel filling the server's area for now, per server. Never saved. */
  maximized: Record<string, number | null>
  /** Server whose member bar is open as a drawer. Only in a narrow window, and never saved: going
   * narrow must not cover the content on its own. */
  membersDrawer: string | null
  /** An item an addon channel should show when it opens (a Kanban card picked in Home). */
  addonItem: { channelId: string; itemId: string } | null
  /** "Editar perfil" is open (from the profile card). */
  profileEditor: boolean

  go(place: Place): void
  /** Goes to Home, on the hub, the friends list or a conversation. */
  openHome(page: HomePage): void
  /** Goes to a server, putting its tab back on the bar if it was closed. */
  openServer(id: string): void
  closeServerTab(id: string, visibleTabs: string[]): void
  /** Moves a server tab before another one (or to the end). */
  moveServerTab(id: string, before: string | null, visibleTabs: string[]): void
  setSidebarCollapsed(collapsed: boolean): void

  /** Opens a tab (or activates it where it's already open). `side` opens it in the other panel. */
  openTab(serverId: string, tab: PanelTab, side?: boolean): void
  activateTab(serverId: string, panel: number, tab: PanelTab): void
  closeTab(serverId: string, panel: number, tab: PanelTab): void
  /**
   * Drops a tab (moved if it's open, opened if not) in a panel, or on one of the panel's edges to
   * split it. `index` is its place among the panel's tabs, counted before the tab leaves them.
   */
  dropTab(serverId: string, tab: PanelTab, panel: number, edge?: Edge | null, index?: number): void
  /** Moves a tab one place within its panel; the overview stays first. */
  moveTabBy(serverId: string, panel: number, tab: PanelTab, delta: -1 | 1): void
  closeOtherTabs(serverId: string, panel: number, tab: PanelTab): void
  closePanel(serverId: string, panel: number): void
  setShownPanels(serverId: string, panels: number[]): void
  /** Fills the area with a panel, or brings the layout back. */
  toggleMaximize(serverId: string, panel: number): void
  /** Moves the divider of the split at `path`. */
  setPanelRatio(serverId: string, path: TreePath, ratio: number): void
  /** Gives the panels along the split at `path` the same size. */
  evenPanels(serverId: string, path: TreePath): void
  focusPanel(serverId: string, panel: number): void
  /** Removes a deleted channel's tab from the server's panels. */
  dropChannelTab(serverId: string, channelId: string): void

  /** Opens or closes the server's member bar (its drawer in a narrow window). */
  toggleMembers(serverId: string): void
  /** Saves the member bar's width for the server; null goes back to the general one. */
  setMembersWidth(serverId: string, width: number | null): void
  setPipMinimized(minimized: boolean): void
  setPipCorner(corner: Corner): void
  /** Shows the call in a panel of its server. */
  expandCall(serverId: string): void
  setCallFullscreen(on: boolean): void
  setNarrow(narrow: boolean): void
  /** Opens an addon channel of a server on one of its items. */
  openAddonItem(serverId: string, channelId: string, itemId: string): void
  clearAddonItem(): void
  setProfileEditor(open: boolean): void
}

export const useNav = create<NavState>()((set, get) => {
  const focused = (serverId: string): number => {
    const panels = layoutOf(serverId).panels.length
    return Math.min(get().focusedPanel[serverId] ?? 0, panels - 1)
  }
  const saveLayout = (serverId: string, layout: PanelLayout): void => {
    // Panels came or went: indexes changed, and the point was to see the whole layout anyway.
    if (layout.panels.length !== layoutOf(serverId).panels.length) {
      set((s) => ({ maximized: { ...s.maximized, [serverId]: null } }))
    }
    useAppearance.getState().updateLayout(serverId, layout)
  }
  const setFocused = (serverId: string, panel: number): void =>
    set((s) => ({ focusedPanel: { ...s.focusedPanel, [serverId]: panel } }))

  /** Drops empty panels from the layout and from `tree`, and keeps the overview pinned. */
  const tidy = (layout: PanelLayout, tree: PanelNode): PanelLayout => {
    const panels = layout.panels.filter((p) => p.tabs.length > 0)
    if (!panels.length) return DEFAULT_LAYOUT
    const fitted = layout.panels.reduceRight((t, p, i) => (p.tabs.length ? t : removePanel(t, i)), tree)
    return pinOverview(withTree({ ...layout, panels }, fitted))
  }

  return {
    place: 'home',
    homePage: 'hub',
    focusedPanel: {},
    pipMinimized: false,
    pipCorner: loadPip().corner,
    callFullscreen: false,
    profileEditor: false,
    narrow: false,
    maximized: {},
    shownPanels: {},
    membersDrawer: null,
    addonItem: null,

    go: (place) => set({ place }),

    openHome: (homePage) => set({ place: 'home', homePage }),

    openServer: (id) => {
      const { settings, update } = useAppearance.getState()
      if (settings.closed_tabs.includes(id) || !settings.tab_order.includes(id)) {
        update({
          closed_tabs: settings.closed_tabs.filter((x) => x !== id),
          tab_order: [...settings.tab_order.filter((x) => x !== id), id]
        })
      }
      set({ place: id })
    },

    closeServerTab: (id, visibleTabs) => {
      const { settings, update } = useAppearance.getState()
      update({ closed_tabs: [...settings.closed_tabs.filter((x) => x !== id), id] })
      if (get().place === id) {
        const i = visibleTabs.indexOf(id)
        const rest = visibleTabs.filter((x) => x !== id)
        set({ place: rest[Math.min(i, rest.length - 1)] ?? 'home' })
      }
    },

    moveServerTab: (id, before, visibleTabs) => {
      const tabs = visibleTabs.filter((x) => x !== id)
      const at = before === null ? tabs.length : tabs.indexOf(before)
      tabs.splice(at < 0 ? tabs.length : at, 0, id)
      const { settings, update } = useAppearance.getState()
      // Closed servers keep their place after the visible ones.
      update({ tab_order: [...tabs, ...settings.tab_order.filter((x) => !tabs.includes(x))] })
    },

    setSidebarCollapsed: (collapsed) => useAppearance.getState().update({ sidebar_collapsed: collapsed }),

    openTab: (serverId, tab, side = false) => {
      const layout = layoutOf(serverId)
      const existing = layout.panels.findIndex((p) => p.tabs.includes(tab))
      if (existing >= 0) return get().activateTab(serverId, existing, tab)

      get().dropTab(serverId, tab, focused(serverId), side ? 'right' : null)
    },

    activateTab: (serverId, panel, tab) => {
      const layout = layoutOf(serverId)
      if (layout.panels[panel]?.active !== tab) {
        saveLayout(serverId, { ...layout, panels: layout.panels.map((p, i) => (i === panel ? { ...p, active: tab } : p)) })
      }
      setFocused(serverId, panel)
    },

    closeTab: (serverId, panel, tab) => {
      if (tab === 'overview') return // pinned
      const layout = layoutOf(serverId)
      const next = tidy({ ...layout, panels: layout.panels.map((p, i) => (i === panel ? without(p, tab) : p)) }, treeOf(layout))
      saveLayout(serverId, next)
      setFocused(serverId, Math.min(focused(serverId), next.panels.length - 1))
    },

    dropTab: (serverId, tab, panel, edge = null, index) => {
      if (tab === 'overview') return // pinned
      const layout = layoutOf(serverId)
      const from = layout.panels.findIndex((p) => p.tabs.includes(tab))
      const alone = from >= 0 && layout.panels[from].tabs.length === 1
      if (edge && alone && from === panel) return // nothing would be left to divide
      if (!edge && index === undefined && from === panel) return get().activateTab(serverId, panel, tab)
      // Taking the only tab of a panel frees a place, so a full layout can still be rearranged.
      const full = layout.panels.length >= MAX_PANELS && !alone
      if (edge && full && !get().narrow) toast(`Máximo de ${MAX_PANELS} painéis`)
      const split = !!edge && !full && !get().narrow

      let tree = treeOf(layout)
      const panels = layout.panels.map((p, i) => (i === from ? without(p, tab) : p))
      if (split) {
        tree = splitPanel(tree, panel, edge, panels.length)
        panels.push({ tabs: [], active: null })
      }
      const into = split ? panels.length - 1 : panel
      const tabs = [...panels[into].tabs]
      const before = from === into ? layout.panels[from].tabs.indexOf(tab) : -1
      const at = index === undefined ? tabs.length : index - (before >= 0 && before < index ? 1 : 0)
      tabs.splice(at, 0, tab)
      panels[into] = { tabs, active: tab }
      saveLayout(serverId, tidy({ ...layout, panels }, tree))
      // Index of the destination after the emptied panel is dropped.
      setFocused(serverId, from >= 0 && from < into && panels[from].tabs.length === 0 ? into - 1 : into)
    },

    moveTabBy: (serverId, panel, tab, delta) => {
      const { tabs } = layoutOf(serverId).panels[panel]
      const index = tabs.indexOf(tab)
      const first = tabs[0] === 'overview' ? 1 : 0
      if (tab === 'overview' || index + delta < first || index + delta >= tabs.length) return
      get().dropTab(serverId, tab, panel, null, delta < 0 ? index - 1 : index + 2)
    },

    closeOtherTabs: (serverId, panel, tab) => {
      const layout = layoutOf(serverId)
      const panels = layout.panels.map((p, i) =>
        i === panel ? { tabs: p.tabs.filter((t) => t === tab || t === 'overview'), active: tab } : p
      )
      saveLayout(serverId, { ...layout, panels })
      setFocused(serverId, panel)
    },

    closePanel: (serverId, panel) => {
      const layout = layoutOf(serverId)
      const tree = removePanel(treeOf(layout), panel)
      saveLayout(serverId, tidy({ ...layout, panels: layout.panels.filter((_, i) => i !== panel) }, tree))
      setFocused(serverId, 0)
    },

    setShownPanels: (serverId, panels) => set((s) => ({ shownPanels: { ...s.shownPanels, [serverId]: panels } })),

    toggleMaximize: (serverId, panel) => {
      if (get().narrow || layoutOf(serverId).panels.length < 2) return
      set((s) => ({ maximized: { ...s.maximized, [serverId]: s.maximized[serverId] === panel ? null : panel } }))
      setFocused(serverId, panel)
    },

    setPanelRatio: (serverId, path, ratio) => {
      const layout = layoutOf(serverId)
      saveLayout(serverId, withTree(layout, setRatio(treeOf(layout), path, ratio)))
    },

    evenPanels: (serverId, path) => {
      const split = nodeAt(treeOf(layoutOf(serverId)), path)
      if (typeof split === 'object') get().setPanelRatio(serverId, path, evenRatio(split))
    },

    focusPanel: (serverId, panel) => {
      if (focused(serverId) !== panel) setFocused(serverId, panel)
    },

    dropChannelTab: (serverId, channelId) => {
      const layout = useAppearance.getState().settings.panel_layouts[serverId]
      const tab = channelTab(channelId)
      if (!layout?.panels.some((p) => p.tabs.includes(tab))) return
      const next = { ...layout, panels: layout.panels.map((p) => without(p, tab)) }
      saveLayout(serverId, tidy(next, treeOf(layout)))
    },

    toggleMembers: (serverId) => {
      if (get().narrow) return set((s) => ({ membersDrawer: s.membersDrawer === serverId ? null : serverId }))
      const layout = layoutOf(serverId)
      saveLayout(serverId, { ...layout, members_open: !membersBarOpen(layout) })
    },

    setMembersWidth: (serverId, width) => saveLayout(serverId, { ...layoutOf(serverId), members_width: width }),

    setPipMinimized: (pipMinimized) => set({ pipMinimized }),

    setPipCorner: (pipCorner) => {
      set({ pipCorner })
      try {
        localStorage.setItem(PIP_KEY, JSON.stringify({ corner: pipCorner }))
      } catch {
        // Not critical: the corner resets next start.
      }
    },

    expandCall: (serverId) => {
      get().openServer(serverId)
      get().openTab(serverId, 'call')
      set({ callFullscreen: false })
    },

    setCallFullscreen: (callFullscreen) => set({ callFullscreen }),

    setNarrow: (narrow) => set({ narrow, membersDrawer: null }),

    setProfileEditor: (profileEditor) => set({ profileEditor }),

    openAddonItem: (serverId, channelId, itemId) => {
      set({ addonItem: { channelId, itemId } })
      get().openServer(serverId)
      get().openTab(serverId, channelTab(channelId))
    },

    clearAddonItem: () => set({ addonItem: null })
  }
})

/** Whether the server's member bar is showing: the saved state, or the drawer in a narrow window. */
export function useMembersBar(serverId: string): boolean {
  const saved = useAppearance((s) => membersBarOpen(s.settings.panel_layouts[serverId]))
  const drawer = useNav((s) => (s.narrow ? s.membersDrawer === serverId : null))
  return drawer ?? saved
}

/**
 * Whether the call is on screen in full: fullscreen, the active tab of a visible panel, or (for a
 * private call) its conversation open in Home.
 */
export function useCallOnScreen(): boolean {
  const inCall = useVoice((s) => s.phase !== 'idle')
  const serverId = useVoice((s) => (s.phase === 'idle' ? null : s.serverId))
  const channelId = useVoice((s) => s.channelId)
  const place = useNav((s) => s.place)
  const homePage = useNav((s) => s.homePage)
  const fullscreen = useNav((s) => s.callFullscreen)
  const shown = useNav((s) => (serverId ? s.shownPanels[serverId] : undefined))
  const layout = useAppearance((s) => (serverId ? s.settings.panel_layouts[serverId] : undefined))
  if (!inCall) return false
  if (fullscreen) return true
  if (!serverId) return place === 'home' && homePage === channelId
  if (place !== serverId || !layout) return false
  return !!shown?.some((i) => layout.panels[i]?.active === 'call')
}
