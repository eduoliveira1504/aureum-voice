import { create } from 'zustand'

import type { Panel, PanelLayout, PanelTab } from '../lib/api'
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

export const MAX_PANELS = 2
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

/** Whether the member list shows next to a server's panels: it's remembered per tab, follows the
 * focused panel's tab, and never shows with the overview (which has its own members block). */
export function membersOpenFor(layout: PanelLayout, focused: number): boolean {
  const active = layout.panels[Math.min(focused, layout.panels.length - 1)]?.active
  return !!active && active !== 'overview' && !!layout.members?.includes(active)
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
  /** Drags a tab into another panel, or to the side to split. */
  moveTab(serverId: string, from: number, tab: PanelTab, to: number | 'side'): void
  closePanel(serverId: string, panel: number): void
  setSplit(serverId: string, split: number): void
  focusPanel(serverId: string, panel: number): void
  /** Removes a deleted channel's tab from the server's panels. */
  dropChannelTab(serverId: string, channelId: string): void

  /** Shows or hides the member list for the active tab of one of the server's panels. */
  toggleMembers(serverId: string, panel?: number): void
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

const saveLayout = (serverId: string, layout: PanelLayout): void =>
  useAppearance.getState().updateLayout(serverId, layout)

export const useNav = create<NavState>()((set, get) => {
  const focused = (serverId: string): number => {
    const panels = layoutOf(serverId).panels.length
    return Math.min(get().focusedPanel[serverId] ?? 0, panels - 1)
  }
  const setFocused = (serverId: string, panel: number): void =>
    set((s) => ({ focusedPanel: { ...s.focusedPanel, [serverId]: panel } }))

  /** Drops empty panels and keeps the overview pinned; forgets the member list of closed tabs. */
  const tidy = (layout: PanelLayout): PanelLayout => {
    const panels = layout.panels.filter((p) => p.tabs.length > 0)
    const open = new Set(panels.flatMap((p) => p.tabs))
    const members = layout.members?.filter((t) => open.has(t))
    return pinOverview(panels.length ? { ...layout, panels, members } : DEFAULT_LAYOUT)
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

      const target = focused(serverId)
      const panels = layout.panels.map((p) => ({ ...p, tabs: [...p.tabs] }))
      let into = target
      if (side && !get().narrow) {
        if (panels.length < MAX_PANELS) {
          panels.push({ tabs: [], active: null })
          into = panels.length - 1
        } else {
          into = target === 0 ? 1 : 0
        }
      }
      panels[into].tabs.push(tab)
      panels[into].active = tab
      saveLayout(serverId, { ...layout, panels })
      setFocused(serverId, into)
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
      const next = tidy({ ...layout, panels: layout.panels.map((p, i) => (i === panel ? without(p, tab) : p)) })
      saveLayout(serverId, next)
      setFocused(serverId, Math.min(focused(serverId), next.panels.length - 1))
    },

    moveTab: (serverId, from, tab, to) => {
      if (tab === 'overview') return // pinned
      const layout = layoutOf(serverId)
      const alone = layout.panels.length === 1 && layout.panels[from].tabs.length === 1
      if (to === from || (to === 'side' && (get().narrow || alone))) return
      let panels = layout.panels.map((p, i) => (i === from ? without(p, tab) : p))
      let into: number
      if (to === 'side') {
        if (panels.length < MAX_PANELS) {
          panels = [...panels, { tabs: [], active: null }]
          into = panels.length - 1
        } else {
          into = from === 0 ? 1 : 0
        }
      } else {
        into = to
      }
      panels[into] = { tabs: [...panels[into].tabs, tab], active: tab }
      // Index of the destination after empty panels are dropped.
      const emptied = panels[from].tabs.length === 0
      const next = tidy({ ...layout, panels })
      saveLayout(serverId, next)
      setFocused(serverId, emptied && into > from ? into - 1 : into)
    },

    closePanel: (serverId, panel) => {
      const layout = layoutOf(serverId)
      saveLayout(serverId, tidy({ ...layout, panels: layout.panels.filter((_, i) => i !== panel) }))
      setFocused(serverId, 0)
    },

    setSplit: (serverId, split) => {
      const layout = layoutOf(serverId)
      saveLayout(serverId, { ...layout, split: Math.min(0.8, Math.max(0.2, split)) })
    },

    focusPanel: (serverId, panel) => {
      if (focused(serverId) !== panel) setFocused(serverId, panel)
    },

    dropChannelTab: (serverId, channelId) => {
      const layout = useAppearance.getState().settings.panel_layouts[serverId]
      const tab = channelTab(channelId)
      if (!layout?.panels.some((p) => p.tabs.includes(tab))) return
      saveLayout(serverId, tidy({ ...layout, panels: layout.panels.map((p) => without(p, tab)) }))
    },

    toggleMembers: (serverId, panel = focused(serverId)) => {
      const layout = layoutOf(serverId)
      const tab = layout.panels[panel]?.active
      if (!tab || tab === 'overview') return
      const members = layout.members ?? []
      const next = members.includes(tab) ? members.filter((t) => t !== tab) : [...members, tab]
      saveLayout(serverId, tidy({ ...layout, members: next }))
    },

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

    setNarrow: (narrow) => set({ narrow }),

    setProfileEditor: (profileEditor) => set({ profileEditor }),

    openAddonItem: (serverId, channelId, itemId) => {
      set({ addonItem: { channelId, itemId } })
      get().openServer(serverId)
      get().openTab(serverId, channelTab(channelId))
    },

    clearAddonItem: () => set({ addonItem: null })
  }
})

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
  const narrow = useNav((s) => s.narrow)
  const focused = useNav((s) => (serverId ? (s.focusedPanel[serverId] ?? 0) : 0))
  const layout = useAppearance((s) => (serverId ? s.settings.panel_layouts[serverId] : undefined))
  if (!inCall) return false
  if (fullscreen) return true
  if (!serverId) return place === 'home' && homePage === channelId
  if (place !== serverId || !layout) return false
  return visiblePanels(layout, focused, narrow).some((i) => layout.panels[i].active === 'call')
}
