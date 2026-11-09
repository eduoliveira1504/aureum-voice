import { ArrowLeft, ArrowRight, Columns2, Hash, LayoutDashboard, Minimize2, Rows2, Volume2, X, type LucideIcon } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

import { addonIcon, addonModule } from '../addons/registry'
import type { Channel, Me, Panel, PanelTab, ServerDetail } from '../lib/api'
import {
  clampRatio,
  dropEdge,
  fitPanels,
  fitRatios,
  leaves,
  PANEL_GAP,
  pathBetween,
  pixels,
  placePanels,
  setRatio,
  type Box,
  type Edge,
  type PlacedDivider,
  type Span,
  type TreePath
} from '../lib/panelTree'
import { channelPermissions, has, Perm, roleColor } from '../lib/permissions'
import { useAppearance } from '../store/appearance'
import { dividableTab, layoutOf, MAX_PANELS, parseTab, readLayout, treeOf, useNav } from '../store/nav'
import { useVoice } from '../store/voice'
import { ChatView } from './ChatView'
import { contextMenu, Item } from './ContextMenu'
import { ServerOverview } from './ServerOverview'
import { VoiceView } from './VoiceView'

/** Drag payload of a panel tab or a sidebar item: `{ tab, from? }` (from = source panel). */
export const PANEL_DRAG_TYPE = 'application/x-aureum-panel-tab'

interface DragPayload {
  tab: PanelTab
  from?: number
}

function readDrag(e: DragEvent): DragPayload | null {
  try {
    const data = JSON.parse(e.dataTransfer.getData(PANEL_DRAG_TYPE))
    return typeof data?.tab === 'string' ? data : null
  } catch {
    return null
  }
}

const isPanelDrag = (e: DragEvent): boolean => e.dataTransfer.types.includes(PANEL_DRAG_TYPE)

/** Where a drag would land in a panel: on an edge, or in the middle as a tab. */
type DropZone = Edge | 'center'

const DROP_AREA: Record<DropZone, string> = {
  left: 'inset-y-0 left-0 w-1/2',
  right: 'inset-y-0 right-0 w-1/2',
  top: 'inset-x-0 top-0 h-1/2',
  bottom: 'inset-x-0 bottom-0 h-1/2',
  center: 'inset-0'
}

const cssLength = ({ share, px }: Span): string => `calc(${share * 100}% + ${px}px)`
const boxStyle = ({ x, y, w, h }: Box): CSSProperties => ({
  left: cssLength(x),
  top: cssLength(y),
  width: cssLength(w),
  height: cssLength(h)
})

/** The element's size, once it's known (never in tests, where nothing has a size). */
function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number } | null] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, size]
}

/**
 * The server's content area: up to four panels divided by a tree, each with its own tabs. They're
 * all children of one element, kept in the order of their ids: changing the tree only changes
 * their boxes, so the chat keeps its scroll and video keeps playing in the panels around a change.
 */
export function Panels({ server, me }: { server: ServerDetail; me: Me }): ReactNode {
  const saved = useAppearance((s) => s.settings.panel_layouts[server.id])
  const layout = useMemo(() => readLayout(saved), [saved])
  const focused = useNav((s) => Math.min(s.focusedPanel[server.id] ?? 0, layout.panels.length - 1))
  const narrow = useNav((s) => s.narrow)

  // An index past the panels: another device closed some of them meanwhile.
  const maximized = useNav((s) => {
    const panel = s.maximized[server.id] ?? null
    return panel !== null && panel < layout.panels.length ? panel : null
  })
  const [area, size] = useSize<HTMLDivElement>()

  // Modals, menus, the member drawer and text fields have their own uses for Esc.
  useEffect(() => {
    if (maximized === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || useNav.getState().membersDrawer) return
      if (document.querySelector('[aria-modal="true"], [role="dialog"], [role="menu"]')) return
      if ((e.target as Element | null)?.closest?.('input, textarea, [contenteditable="true"]')) return
      useNav.getState().toggleMaximize(server.id, maximized)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maximized, server.id])

  const fitted = useMemo(() => {
    const full = treeOf(layout)
    if (narrow || maximized !== null || !size) return { tree: narrow ? focused : (maximized ?? full), folded: {} as Record<number, number[]> }
    const { tree: rest, folded: over } = fitPanels(full, size.width, size.height)
    return { tree: fitRatios(rest, size.width, size.height), folded: over }
  }, [layout, narrow, focused, maximized, size])
  const { tree: fittedTree, folded } = fitted
  const [live, setLive] = useState<{ path: TreePath; ratio: number } | null>(null)
  const tree = live ? setRatio(fittedTree, live.path, live.ratio) : fittedTree
  const several = typeof tree !== 'number'

  /** A panel with others folded into it shows whichever of them has the focus. */
  const showing = (host: number): number => (folded[host]?.includes(focused) ? focused : host)
  const shownKey = leaves(tree).map(showing).join(',')
  useEffect(() => {
    useNav.getState().setShownPanels(server.id, shownKey.split(',').map(Number))
  }, [server.id, shownKey])
  const canDivide = !narrow && maximized === null && layout.panels.length < MAX_PANELS

  const placed = placePanels(tree)
  const byId = (index: number): string => layout.panels[showing(index)].id as string
  const inOrder = [...placed.panels].sort((a, b) => (byId(a.index) < byId(b.index) ? -1 : 1))

  return (
    <div className="relative min-w-0 flex-1">
      <div ref={area} data-tour="paineis" className="absolute bottom-2 left-0 right-2 top-2">
        {inOrder.map(({ index: host, box }) => (
          <PanelView
            key={byId(host)}
            server={server}
            me={me}
            index={showing(host)}
            panel={layout.panels[showing(host)]}
            tabs={[host, ...(folded[host] ?? [])].flatMap((owner) => layout.panels[owner].tabs.map((tab) => ({ tab, owner })))}
            canClose={several}
            canDivide={canDivide}
            maximized={maximized !== null}
            focused={several && showing(host) === focused}
            box={box}
          />
        ))}
        {placed.dividers.map((divider) => (
          <Divider
            key={divider.path}
            serverId={server.id}
            divider={divider}
            savedPath={pathBetween(treeOf(layout), leaves(divider.split.a)[0], leaves(divider.split.b)[0])}
            onLive={(ratio) => setLive(ratio === null ? null : { path: divider.path, ratio })}
          />
        ))}
      </div>
    </div>
  )
}

function Divider({
  serverId,
  divider,
  savedPath,
  onLive
}: {
  serverId: string
  divider: PlacedDivider
  /** Its split in the saved tree, which differs from the one on screen with panels folded. */
  savedPath: TreePath
  onLive(ratio: number | null): void
}): ReactNode {
  const { split, box, whole } = divider
  const row = split.dir === 'row'

  const onPointerDown = (e: ReactPointerEvent): void => {
    const target = e.currentTarget as HTMLElement
    const rect = target.parentElement?.getBoundingClientRect()
    if (!rect) return
    target.setPointerCapture(e.pointerId)
    const area = row ? rect.width : rect.height
    const start = pixels(row ? whole.x : whole.y, area)
    const size = pixels(row ? whole.w : whole.h, area)
    const at = (ev: PointerEvent): number => {
      const pointer = (row ? ev.clientX - rect.left : ev.clientY - rect.top) - start - PANEL_GAP / 2
      return clampRatio(split, pointer / (size - PANEL_GAP), size)
    }
    const move = (ev: PointerEvent): void => onLive(at(ev))
    const up = (ev: PointerEvent): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      onLive(null)
      useNav.getState().setPanelRatio(serverId, savedPath, at(ev))
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  return (
    <div
      role="separator"
      aria-orientation={row ? 'vertical' : 'horizontal'}
      aria-label="Redimensionar painéis"
      onPointerDown={onPointerDown}
      onDoubleClick={() => useNav.getState().evenPanels(serverId, savedPath)}
      style={boxStyle(box)}
      className={`group absolute flex items-center justify-center ${row ? 'cursor-col-resize' : 'cursor-row-resize'}`}
    >
      <span className={`rounded-full bg-line transition-colors group-hover:bg-accent ${row ? 'h-10 w-1' : 'h-1 w-10'}`} />
    </div>
  )
}

/** Where a tab dragged over the tab strip would go: before the first tab past the pointer. */
function tabIndexAt(strip: Element, x: number, first: number): number {
  const tabs = [...strip.querySelectorAll('[role="tab"]')]
  const index = tabs.findIndex((tab) => {
    const rect = tab.getBoundingClientRect()
    return x < rect.left + rect.width / 2
  })
  return Math.max(first, index < 0 ? tabs.length : index)
}

function TabMenu({ serverId, index, tab }: { serverId: string; index: number; tab: PanelTab }): ReactNode {
  const { closeOtherTabs, moveTabBy } = useNav.getState()
  const panel = layoutOf(serverId).panels[index]
  const at = panel.tabs.indexOf(tab)
  const first = panel.tabs[0] === 'overview' ? 1 : 0
  const movable = tab !== 'overview'
  return (
    <>
      {movable && at > first && <Item icon={ArrowLeft} label="Mover para a esquerda" onClick={() => moveTabBy(serverId, index, tab, -1)} />}
      {movable && at < panel.tabs.length - 1 && <Item icon={ArrowRight} label="Mover para a direita" onClick={() => moveTabBy(serverId, index, tab, 1)} />}
      <Item icon={X} label="Fechar outras" onClick={() => closeOtherTabs(serverId, index, tab)} />
    </>
  )
}

function tabInfo(tab: PanelTab, server: ServerDetail, callRoom: string | null): { icon: LucideIcon; label: string } {
  const ref = parseTab(tab)
  switch (ref.kind) {
    case 'overview':
      return { icon: LayoutDashboard, label: 'Visão geral' }
    case 'call':
      return { icon: Volume2, label: callRoom ? `Chamada · ${callRoom}` : 'Chamada' }
    case 'channel': {
      const channel = server.channels.find((c) => c.id === ref.id)
      const icon = channel?.type === 'voice' ? Volume2 : channel?.type === 'addon' ? addonIcon(channel.addon_key) : Hash
      return { icon, label: channel?.name ?? '…' }
    }
  }
}

function PanelView({
  server,
  me,
  index,
  panel,
  tabs,
  canClose,
  canDivide,
  maximized,
  focused,
  box
}: {
  server: ServerDetail
  me: Me
  index: number
  panel: Panel
  /** The tabs on its strip: its own, then those of panels folded into it. */
  tabs: { tab: PanelTab; owner: number }[]
  canClose: boolean
  canDivide: boolean
  maximized: boolean
  focused: boolean
  box: Box
}): ReactNode {
  const { activateTab, closeTab, closePanel, dropTab, focusPanel, toggleMaximize } = useNav.getState()
  const callRoom = useVoice((s) =>
    s.phase !== 'idle' && s.serverId === server.id ? (server.channels.find((c) => c.id === s.channelId)?.name ?? null) : null
  )
  const narrow = useNav((s) => s.narrow)
  const [zone, setZone] = useState<DropZone | null>(null)
  const [tabLine, setTabLine] = useState<number | null>(null)
  const firstTab = panel.tabs[0] === 'overview' ? 1 : 0
  const divisible = dividableTab(panel)

  const zoneAt = (e: DragEvent): DropZone => {
    const rect = e.currentTarget.getBoundingClientRect()
    const edge = narrow ? null : dropEdge((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
    return edge ?? 'center'
  }

  const onDrop = (e: DragEvent): void => {
    const edge = zoneAt(e)
    setZone(null)
    const data = readDrag(e)
    if (data) dropTab(server.id, data.tab, index, edge === 'center' ? null : edge)
  }

  const divideButton = (edge: Edge, label: string, Icon: LucideIcon): ReactNode => (
    <button
      type="button"
      title={divisible ? label : 'Abra outra aba para dividir'}
      aria-label={label}
      disabled={!divisible}
      onClick={() => divisible && dropTab(server.id, divisible, index, edge)}
      className="rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <Icon size={16} />
    </button>
  )

  return (
    <section
      aria-label={`Painel ${index + 1}`}
      onMouseDownCapture={() => focusPanel(server.id, index)}
      style={boxStyle(box)}
      className={`absolute flex flex-col overflow-hidden rounded-panel border bg-main ${
        focused ? 'border-accent/40' : 'border-line'
      }`}
      onDragOver={(e) => {
        if (!isPanelDrag(e)) return
        e.preventDefault()
        setZone(zoneAt(e))
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setZone(null)}
      onDrop={onDrop}
    >
      {zone && <div data-drop-zone={zone} className={`pointer-events-none absolute z-30 border-2 border-dashed border-accent bg-accent/15 ${DROP_AREA[zone]}`} />}
      <div
        data-testid="panel-header"
        onDoubleClick={(e) => !(e.target as Element).closest('button') && toggleMaximize(server.id, index)}
        className="flex h-11 shrink-0 items-end gap-1 border-b border-line bg-panel/60 px-2"
      >
        <div
          role="tablist"
          className="no-scrollbar flex min-w-0 flex-1 items-end gap-1 self-stretch overflow-x-auto"
          onDragOver={(e) => {
            if (!isPanelDrag(e)) return
            e.preventDefault()
            e.stopPropagation()
            setZone(null)
            setTabLine(tabIndexAt(e.currentTarget, e.clientX, firstTab))
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setTabLine(null)}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setTabLine(null)
            const data = readDrag(e)
            if (data) dropTab(server.id, data.tab, index, null, tabIndexAt(e.currentTarget, e.clientX, firstTab))
          }}
        >
          {tabs.map(({ tab, owner }, position) => {
            const { icon: Icon, label } = tabInfo(tab, server, callRoom)
            const active = tab === panel.active
            // The overview is pinned: first, can't be closed or dragged away.
            const pinned = tab === 'overview'
            return (
              <Fragment key={tab}>
              {tabLine === position && <span data-tab-line className="-mx-[3px] mb-1.5 h-6 w-0.5 shrink-0 self-end rounded-full bg-accent" />}
              <div
                role="tab"
                tabIndex={0}
                aria-selected={active}
                draggable={!pinned}
                onDragStart={(e) => {
                  e.dataTransfer.setData(PANEL_DRAG_TYPE, JSON.stringify({ tab, from: owner }))
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onClick={() => activateTab(server.id, owner, tab)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && activateTab(server.id, owner, tab)}
                onAuxClick={(e) => e.button === 1 && closeTab(server.id, owner, tab)}
                onContextMenu={contextMenu(() => <TabMenu serverId={server.id} index={owner} tab={tab} />)}
                onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                className={`group flex h-9 max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-item px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  active ? 'bg-main font-medium text-fg' : 'text-fg-muted hover:bg-main/50 hover:text-fg'
                }`}
              >
                <Icon size={15} className="shrink-0 opacity-80" />
                <span className="truncate">{label}</span>
                {!pinned && (
                  <button
                    type="button"
                    title="Fechar aba"
                    aria-label={`Fechar ${label}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(server.id, owner, tab)
                    }}
                    className={`rounded p-0.5 text-fg-subtle hover:bg-elevated hover:text-fg ${active ? '' : 'opacity-0 group-hover:opacity-100'}`}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              </Fragment>
            )
          })}
          {tabLine === tabs.length && <span data-tab-line className="-mx-[3px] mb-1.5 h-6 w-0.5 shrink-0 self-end rounded-full bg-accent" />}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 self-center">
          {maximized && (
            <button
              type="button"
              title="Voltar ao layout (Esc)"
              aria-label="Voltar ao layout"
              onClick={() => toggleMaximize(server.id, index)}
              className="rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg"
            >
              <Minimize2 size={16} />
            </button>
          )}
          {canDivide && divideButton('right', 'Dividir para o lado', Columns2)}
          {canDivide && divideButton('bottom', 'Dividir para baixo', Rows2)}
          {canClose && (
            <button
              type="button"
              title="Fechar painel"
              aria-label="Fechar painel"
              onClick={() => closePanel(server.id, index)}
              className="rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {panel.active ? <TabContent tab={panel.active} server={server} me={me} /> : null}
      </div>
    </section>
  )
}

function TabContent({ tab, server, me }: { tab: PanelTab; server: ServerDetail; me: Me }): ReactNode {
  const callChannelId = useVoice((s) => (s.phase !== 'idle' && s.serverId === server.id ? s.channelId : null))
  const ref = parseTab(tab)

  switch (ref.kind) {
    case 'overview':
      return <ServerOverview server={server} me={me} />
    case 'call': {
      const channel = server.channels.find((c) => c.id === callChannelId)
      if (!channel) return <Placeholder title="Você não está numa chamada" text="Entre numa sala para ver a chamada aqui." />
      return <VoiceView server={server} channel={channel} meId={me.id} />
    }
    case 'channel': {
      const channel = server.channels.find((c) => c.id === ref.id)
      if (!channel) return <Placeholder title="Carregando…" text="" />
      if (channel.type === 'addon') return <AddonView key={channel.id} server={server} channel={channel} me={me} />
      if (channel.type === 'text') {
        const perms = channelPermissions(server, channel, me.id)
        return (
          <ChatView
            key={channel.id}
            channel={channel}
            me={me}
            canModerate={has(perms, Perm.MANAGE_MESSAGES)}
            canSend={has(perms, Perm.SEND_MESSAGES)}
            canAttach={has(perms, Perm.ATTACH_FILES)}
            canReact={has(perms, Perm.ADD_REACTIONS)}
            canStickers={has(perms, Perm.USE_STICKERS)}
            nameColorOf={(userId) => roleColor(server, userId)}
            nameOf={(userId) => server.members.find((m) => m.user.id === userId)?.nickname ?? null}
          />
        )
      }
      return <VoiceView server={server} channel={channel} meId={me.id} />
    }
  }
}

export function Placeholder({ title, text, children }: { title: string; text: string; children?: ReactNode }): ReactNode {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
      <h2 className="text-2xl font-semibold">{title}</h2>
      {text && <p className="mt-2 max-w-md text-fg-muted">{text}</p>}
      {children}
    </div>
  )
}

/** An addon channel: its addon's own panel, or a note when this app version doesn't have it. */
function AddonView({ server, channel, me }: { server: ServerDetail; channel: Channel; me: Me }): ReactNode {
  const addon = addonModule(channel.addon_key)
  const openItem = useNav((s) => (s.addonItem?.channelId === channel.id ? s.addonItem.itemId : null))
  if (!addon) {
    return <Placeholder title={channel.name ?? 'Addon'} text="Este addon não existe nesta versão do Aureum. Atualize o app para usá-lo." />
  }
  return (
    <addon.Panel
      server={server}
      channel={channel}
      me={me}
      perms={channelPermissions(server, channel, me.id)}
      openItem={openItem}
      onItemOpened={useNav.getState().clearAddonItem}
    />
  )
}
