import { Columns2, Hash, LayoutDashboard, Users, Volume2, X, type LucideIcon } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

import { addonInfo } from '../addons/registry'
import type { Me, Panel, PanelTab, ServerDetail } from '../lib/api'
import { channelPermissions, has, Perm, roleColor } from '../lib/permissions'
import { useAppearance } from '../store/appearance'
import { DEFAULT_LAYOUT, parseTab, pinOverview, useNav, visiblePanels } from '../store/nav'
import { useVoice } from '../store/voice'
import { ChatView } from './ChatView'
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

/** True while a tab or sidebar item is being dragged anywhere in the window. */
function usePanelDragging(): boolean {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const start = (e: globalThis.DragEvent): void => {
      if (e.dataTransfer?.types.includes(PANEL_DRAG_TYPE)) setDragging(true)
    }
    const end = (): void => setDragging(false)
    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => {
      window.removeEventListener('dragstart', start)
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
    }
  }, [])
  return dragging
}

/** The server's content area: one or two panels side by side, each with its own tabs. */
export function Panels({ server, me }: { server: ServerDetail; me: Me }): ReactNode {
  const saved = useAppearance((s) => s.settings.panel_layouts[server.id])
  const layout = useMemo(() => pinOverview(saved?.panels.length ? saved : DEFAULT_LAYOUT), [saved])
  const focused = useNav((s) => Math.min(s.focusedPanel[server.id] ?? 0, layout.panels.length - 1))
  const narrow = useNav((s) => s.narrow)
  const { openTab, moveTab, setSplit } = useNav.getState()
  const dragging = usePanelDragging()
  const [liveSplit, setLiveSplit] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const visible = visiblePanels(layout, focused, narrow)
  const split = liveSplit ?? layout.split
  const canSplit = !narrow && visible.length === 1

  const onDividerDown = (e: ReactPointerEvent): void => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const at = (x: number): number => Math.min(0.8, Math.max(0.2, (x - rect.left) / rect.width))
    const move = (ev: PointerEvent): void => setLiveSplit(at(ev.clientX))
    const up = (ev: PointerEvent): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      setLiveSplit(null)
      setSplit(server.id, at(ev.clientX))
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  return (
    <div ref={ref} className="relative flex min-w-0 flex-1 py-2 pr-2">
      {visible.map((index, n) => (
        <Fragment key={index}>
          {n === 1 && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Redimensionar painéis"
              onPointerDown={onDividerDown}
              onDoubleClick={() => setSplit(server.id, 0.5)}
              className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
            >
              <span className="h-10 w-1 rounded-full bg-line transition-colors group-hover:bg-accent" />
            </div>
          )}
          <PanelView
            server={server}
            me={me}
            index={index}
            panel={layout.panels[index]}
            canClose={visible.length > 1}
            focused={visible.length > 1 && focused === index}
            grow={visible.length > 1 ? (n === 0 ? split : 1 - split) : 1}
          />
        </Fragment>
      ))}

      {/* While dragging, the right side of a single panel opens what's dropped in a second one. */}
      {dragging && canSplit && (
        <div
          onDragOver={(e) => isPanelDrag(e) && e.preventDefault()}
          onDrop={(e) => {
            const data = readDrag(e)
            if (!data) return
            if (data.from === undefined) openTab(server.id, data.tab, true)
            else moveTab(server.id, data.from, data.tab, 'side')
          }}
          className="absolute bottom-2 right-2 top-2 z-20 flex w-[38%] items-center justify-center rounded-panel border-2 border-dashed border-accent bg-accent/10 text-accent-text"
        >
          <span className="flex items-center gap-2 rounded-control bg-main px-3 py-2 text-sm font-semibold shadow">
            <Columns2 size={18} />
            Abrir ao lado
          </span>
        </div>
      )}
    </div>
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
      return { icon: channel?.type === 'voice' ? Volume2 : Hash, label: channel?.name ?? '…' }
    }
    case 'addon': {
      const addon = addonInfo(ref.key)
      return { icon: addon?.icon ?? LayoutDashboard, label: addon?.name ?? ref.key }
    }
  }
}

function PanelView({
  server,
  me,
  index,
  panel,
  canClose,
  focused,
  grow
}: {
  server: ServerDetail
  me: Me
  index: number
  panel: Panel
  canClose: boolean
  focused: boolean
  grow: number
}): ReactNode {
  const { activateTab, closeTab, closePanel, focusPanel, moveTab, openTab, toggleMembers } = useNav.getState()
  const membersOpen = useAppearance((s) => s.settings.members_open)
  const callRoom = useVoice((s) =>
    s.phase !== 'idle' && s.serverId === server.id ? (server.channels.find((c) => c.id === s.channelId)?.name ?? null) : null
  )
  const [dropHere, setDropHere] = useState(false)

  const onDrop = (e: DragEvent): void => {
    setDropHere(false)
    const data = readDrag(e)
    if (!data) return
    if (data.from === undefined) {
      focusPanel(server.id, index)
      openTab(server.id, data.tab)
    } else if (data.from !== index) {
      moveTab(server.id, data.from, data.tab, index)
    }
  }

  return (
    <section
      aria-label={`Painel ${index + 1}`}
      onMouseDownCapture={() => focusPanel(server.id, index)}
      style={{ flex: `${grow} 1 0` }}
      className={`flex min-w-0 flex-col overflow-hidden rounded-panel border bg-main ${
        focused ? 'border-accent/40' : 'border-line'
      } ${dropHere ? 'ring-2 ring-accent' : ''}`}
      onDragOver={(e) => {
        if (!isPanelDrag(e)) return
        e.preventDefault()
        setDropHere(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropHere(false)}
      onDrop={onDrop}
    >
      <div className="flex h-11 shrink-0 items-end gap-1 border-b border-line bg-panel/60 px-2">
        <div role="tablist" className="no-scrollbar flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
          {panel.tabs.map((tab) => {
            const { icon: Icon, label } = tabInfo(tab, server, callRoom)
            const active = tab === panel.active
            // The overview is pinned: first, can't be closed or dragged away.
            const pinned = tab === 'overview'
            return (
              <div
                key={tab}
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
            )
          })}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 self-center">
          <button
            type="button"
            title="Membros"
            aria-label="Membros"
            aria-pressed={membersOpen}
            onClick={toggleMembers}
            className={`flex items-center gap-1.5 rounded-item px-2 py-1.5 text-sm hover:bg-elevated ${membersOpen ? 'text-fg' : 'text-fg-muted'}`}
          >
            <Users size={16} />
            <span className="hidden xl:inline">Membros</span>
          </button>
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
      if (channel.type === 'text') {
        const perms = channelPermissions(server, channel, me.id)
        return (
          <ChatView
            key={channel.id}
            channel={channel}
            me={me}
            canModerate={has(perms, Perm.MANAGE_MESSAGES)}
            canSend={has(perms, Perm.SEND_MESSAGES)}
            nameColorOf={(userId) => roleColor(server, userId)}
          />
        )
      }
      return <VoiceView server={server} channel={channel} meId={me.id} />
    }
    case 'addon':
      return <AddonPlaceholder addonKey={ref.key} />
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

function AddonPlaceholder({ addonKey }: { addonKey: string }): ReactNode {
  const addon = addonInfo(addonKey)
  const Icon = addon?.icon ?? LayoutDashboard
  return (
    <Placeholder title={addon?.name ?? 'Addon'} text={addon?.description ?? ''}>
      <div className="order-first mb-4 flex h-16 w-16 items-center justify-center rounded-panel bg-elevated text-accent-text">
        <Icon size={32} />
      </div>
      <span className="mt-4 rounded-full border border-line px-3 py-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        Em breve
      </span>
    </Placeholder>
  )
}
