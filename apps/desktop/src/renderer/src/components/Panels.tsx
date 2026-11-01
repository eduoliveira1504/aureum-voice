import { ArrowLeft, ArrowRight, Columns2, Hash, LayoutDashboard, Rows2, Volume2, X, type LucideIcon } from 'lucide-react'
import { Fragment, useMemo, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

import { addonIcon, addonModule } from '../addons/registry'
import type { Channel, Me, Panel, PanelNode, PanelSplit, PanelTab, ServerDetail } from '../lib/api'
import { clampRatio, dropEdge, type Edge, type TreePath } from '../lib/panelTree'
import { channelPermissions, has, Perm, roleColor } from '../lib/permissions'
import { useAppearance } from '../store/appearance'
import { DEFAULT_LAYOUT, dividableTab, MAX_PANELS, parseTab, pinOverview, treeOf, useNav } from '../store/nav'
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

/** The server's content area: up to four panels divided by a tree, each with its own tabs. */
export function Panels({ server, me }: { server: ServerDetail; me: Me }): ReactNode {
  const saved = useAppearance((s) => s.settings.panel_layouts[server.id])
  const layout = useMemo(() => pinOverview(saved?.panels.length ? saved : DEFAULT_LAYOUT), [saved])
  const focused = useNav((s) => Math.min(s.focusedPanel[server.id] ?? 0, layout.panels.length - 1))
  const narrow = useNav((s) => s.narrow)

  const tree = narrow ? focused : treeOf(layout)
  const several = typeof tree !== 'number'
  const canDivide = !narrow && layout.panels.length < MAX_PANELS

  const leaf = (index: number, grow: number): ReactNode => (
    <PanelView
      key={index}
      server={server}
      me={me}
      index={index}
      panel={layout.panels[index]}
      canClose={several}
      canDivide={canDivide}
      focused={several && focused === index}
      grow={grow}
    />
  )

  return (
    <div className="relative flex min-w-0 flex-1 py-2 pr-2">
      <PanelBranch serverId={server.id} node={tree} path="" grow={1} leaf={leaf} />
    </div>
  )
}

/** One side of a division: a panel, or two sides with a divider between them. */
function PanelBranch({
  serverId,
  node,
  path,
  grow,
  leaf
}: {
  serverId: string
  node: PanelNode
  path: TreePath
  grow: number
  leaf(index: number, grow: number): ReactNode
}): ReactNode {
  const [live, setLive] = useState<number | null>(null)
  if (typeof node === 'number') return leaf(node, grow)
  const ratio = live ?? node.ratio
  return (
    <div style={{ flex: `${grow} 1 0` }} className={`flex min-h-0 min-w-0 ${node.dir === 'row' ? '' : 'flex-col'}`}>
      <PanelBranch serverId={serverId} node={node.a} path={`${path}a`} grow={ratio} leaf={leaf} />
      <Divider serverId={serverId} split={node} path={path} onLive={setLive} />
      <PanelBranch serverId={serverId} node={node.b} path={`${path}b`} grow={1 - ratio} leaf={leaf} />
    </div>
  )
}

function Divider({
  serverId,
  split,
  path,
  onLive
}: {
  serverId: string
  split: PanelSplit
  path: TreePath
  onLive(ratio: number | null): void
}): ReactNode {
  const row = split.dir === 'row'

  const onPointerDown = (e: ReactPointerEvent): void => {
    const target = e.currentTarget as HTMLElement
    const rect = target.parentElement?.getBoundingClientRect()
    if (!rect) return
    target.setPointerCapture(e.pointerId)
    const size = row ? rect.width : rect.height
    const at = (ev: PointerEvent): number =>
      clampRatio(split, ((row ? ev.clientX - rect.left : ev.clientY - rect.top) / size), size)
    const move = (ev: PointerEvent): void => onLive(at(ev))
    const up = (ev: PointerEvent): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      onLive(null)
      useNav.getState().setPanelRatio(serverId, path, at(ev))
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
      onDoubleClick={() => useNav.getState().evenPanels(serverId, path)}
      className={`group flex shrink-0 items-center justify-center ${row ? 'w-2 cursor-col-resize' : 'h-2 cursor-row-resize'}`}
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

function TabMenu({ serverId, index, panel, tab }: { serverId: string; index: number; panel: Panel; tab: PanelTab }): ReactNode {
  const { closeOtherTabs, moveTabBy } = useNav.getState()
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
  canClose,
  canDivide,
  focused,
  grow
}: {
  server: ServerDetail
  me: Me
  index: number
  panel: Panel
  canClose: boolean
  canDivide: boolean
  focused: boolean
  grow: number
}): ReactNode {
  const { activateTab, closeTab, closePanel, dropTab, focusPanel } = useNav.getState()
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
      style={{ flex: `${grow} 1 0` }}
      className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-panel border bg-main ${
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
      <div className="flex h-11 shrink-0 items-end gap-1 border-b border-line bg-panel/60 px-2">
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
          {panel.tabs.map((tab, position) => {
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
                  e.dataTransfer.setData(PANEL_DRAG_TYPE, JSON.stringify({ tab, from: index }))
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onClick={() => activateTab(server.id, index, tab)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && activateTab(server.id, index, tab)}
                onAuxClick={(e) => e.button === 1 && closeTab(server.id, index, tab)}
                onContextMenu={contextMenu(() => <TabMenu serverId={server.id} index={index} panel={panel} tab={tab} />)}
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
                      closeTab(server.id, index, tab)
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
          {tabLine === panel.tabs.length && <span data-tab-line className="-mx-[3px] mb-1.5 h-6 w-0.5 shrink-0 self-end rounded-full bg-accent" />}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 self-center">
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
