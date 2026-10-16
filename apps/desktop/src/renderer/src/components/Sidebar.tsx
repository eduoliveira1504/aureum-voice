import {
  ChevronDown,
  Hash,
  LayoutDashboard,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Trash2,
  Users,
  Volume2,
  X,
  type LucideIcon
} from 'lucide-react'
import { useCallback, useRef, useState, type MouseEvent, type ReactNode } from 'react'

import { ADDONS } from '../addons/registry'
import { api, type Channel, type Me, type ServerDetail } from '../lib/api'
import { useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { addonTab, channelTab, layoutOf, useNav, visiblePanels } from '../store/nav'
import { useVoice } from '../store/voice'
import { CallCard } from './CallCard'
import { ConfirmModal, CreateChannelModal, InviteModal } from './modals'
import { PANEL_DRAG_TYPE } from './Panels'
import { CountBadge, menuClass, MenuItem, ServerIcon, useDismiss } from './ui'

type Dialog =
  | { kind: 'invite' }
  | { kind: 'channel'; type: 'text' | 'voice' }
  | { kind: 'leave' }
  | { kind: 'delete' }
  | { kind: 'deleteChannel'; channel: Channel }

/** Left column: the current tab's places (server sections or Home), and the call card at the bottom. */
export function Sidebar({ server, me }: { server: ServerDetail | null; me: Me }): ReactNode {
  const saved = useAppearance((s) => s.settings.sidebar_collapsed)
  const narrow = useNav((s) => s.narrow)
  const setCollapsed = useNav((s) => s.setSidebarCollapsed)
  // A narrow window always shows icons only, without changing the saved choice.
  const collapsed = saved || narrow

  return (
    <aside className={`flex shrink-0 flex-col bg-panel transition-[width] ${collapsed ? 'w-[64px]' : 'w-60'}`}>
      {server ? (
        <ServerPlaces server={server} me={me} collapsed={collapsed} onCollapse={narrow ? undefined : setCollapsed} />
      ) : (
        <HomePlaces collapsed={collapsed} onCollapse={narrow ? undefined : setCollapsed} />
      )}
      <VoiceError collapsed={collapsed} />
      <CallCard collapsed={collapsed} />
    </aside>
  )
}

function CollapseButton({ collapsed, onCollapse }: { collapsed: boolean; onCollapse?: (c: boolean) => void }): ReactNode {
  if (!onCollapse) return null
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  const label = collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => onCollapse(!collapsed)}
      className="rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg"
    >
      <Icon size={18} />
    </button>
  )
}

/** One clickable place in the sidebar (or just its icon when collapsed). */
function Item({
  icon: Icon,
  label,
  collapsed,
  active = false,
  panelHint,
  badge,
  dot,
  trailing,
  dragTab,
  onClick,
  onSide
}: {
  icon: LucideIcon
  label: string
  collapsed: boolean
  active?: boolean
  /** "1/2" when the item is open in one of two panels. */
  panelHint?: string
  badge?: ReactNode
  dot?: 'success' | 'accent'
  trailing?: ReactNode
  /** Panel tab this item opens; lets it be dragged into the panel area. */
  dragTab?: string
  onClick(): void
  /** Middle click / Ctrl+click: open in the other panel. */
  onSide?: () => void
}): ReactNode {
  const side = (e: MouseEvent): boolean => {
    if (!onSide || !(e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey)))) return false
    e.preventDefault()
    onSide()
    return true
  }
  return (
    <div
      className={`group relative flex items-center rounded-item ${
        active ? 'bg-elevated text-fg' : 'text-fg-muted hover:bg-elevated/60 hover:text-fg'
      }`}
    >
      <button
        type="button"
        title={collapsed ? label : undefined}
        aria-label={collapsed ? label : undefined}
        draggable={!!dragTab}
        onDragStart={(e) => dragTab && e.dataTransfer.setData(PANEL_DRAG_TYPE, JSON.stringify({ tab: dragTab }))}
        onClick={(e) => side(e) || onClick()}
        onAuxClick={side}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()} // no autoscroll on middle click
        className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left ${collapsed ? 'justify-center px-0' : 'px-2'}`}
      >
        <span className="relative shrink-0">
          <Icon size={18} className={active ? 'opacity-100' : 'opacity-75'} />
          {dot && (
            <span
              className={`absolute -right-1 -top-1 h-2 w-2 rounded-full border border-panel ${dot === 'success' ? 'bg-success' : 'bg-accent'}`}
            />
          )}
        </span>
        {!collapsed && <span className="min-w-0 flex-1 truncate font-medium">{label}</span>}
        {!collapsed && panelHint && (
          <span title="Aberto no painel" className="shrink-0 rounded bg-main px-1 text-[10px] font-semibold text-fg-subtle">
            painel {panelHint}
          </span>
        )}
        {!collapsed && badge}
      </button>
      {!collapsed && trailing}
    </div>
  )
}

function Section({
  title,
  collapsed,
  onAdd,
  children
}: {
  title: string
  collapsed: boolean
  onAdd?: () => void
  children: ReactNode
}): ReactNode {
  const [open, setOpen] = useState(true)
  if (collapsed) return <div className="space-y-0.5 border-t border-line pt-2">{children}</div>
  return (
    <section>
      <div className="mb-1 flex items-center px-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle hover:text-fg-muted"
        >
          <ChevronDown size={12} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
          {title}
        </button>
        {onAdd && (
          <button type="button" title="Criar" aria-label={`Criar em ${title}`} onClick={onAdd} className="text-fg-subtle hover:text-fg">
            <Plus size={16} />
          </button>
        )}
      </div>
      {open && <div className="space-y-0.5">{children}</div>}
    </section>
  )
}

function ServerPlaces({
  server,
  me,
  collapsed,
  onCollapse
}: {
  server: ServerDetail
  me: Me
  collapsed: boolean
  onCollapse?: (c: boolean) => void
}): ReactNode {
  const reads = useChat((s) => s.reads)
  const openTab = useNav((s) => s.openTab)
  const narrow = useNav((s) => s.narrow)
  const focusedPanel = useNav((s) => s.focusedPanel[server.id] ?? 0)
  useAppearance((s) => s.settings.panel_layouts[server.id]) // re-render when panels change
  const callChannelId = useVoice((s) => (s.phase === 'idle' ? null : s.channelId))
  const join = useVoice((s) => s.join)
  const expandCall = useNav((s) => s.expandCall)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const myRole = server.members.find((m) => m.user.id === me.id)?.role
  const canManage = myRole === 'owner' || myRole === 'admin'

  // Where each tab is showing: highlighted when it's a panel's active tab.
  const layout = layoutOf(server.id)
  const visible = visiblePanels(layout, focusedPanel, narrow)
  const placeOf = (tab: string): { active: boolean; hint?: string } => {
    const i = layout.panels.findIndex((p) => p.active === tab)
    if (i < 0 || !visible.includes(i)) return { active: false }
    return { active: true, hint: visible.length > 1 ? `${i + 1}/${visible.length}` : undefined }
  }

  const rooms = server.channels.filter((c) => c.type === 'voice')
  const texts = server.channels.filter((c) => c.type === 'text')

  return (
    <>
      <ServerHeader
        server={server}
        collapsed={collapsed}
        canManage={canManage}
        isOwner={myRole === 'owner'}
        onPick={setDialog}
        onCollapse={onCollapse}
      />

      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        <Item
          icon={LayoutDashboard}
          label="Visão geral"
          collapsed={collapsed}
          active={placeOf('overview').active}
          panelHint={placeOf('overview').hint}
          dragTab="overview"
          onClick={() => openTab(server.id, 'overview')}
          onSide={() => openTab(server.id, 'overview', true)}
        />

        <Section title="Salas" collapsed={collapsed} onAdd={canManage ? () => setDialog({ kind: 'channel', type: 'voice' }) : undefined}>
          {rooms.map((room) => {
            const here = server.voice_states.filter((v) => v.channel_id === room.id)
            const live = here.some((v) => v.screen)
            const mine = callChannelId === room.id
            return (
              <Item
                key={room.id}
                icon={Volume2}
                label={room.name ?? ''}
                collapsed={collapsed}
                active={mine}
                dot={here.length ? 'success' : undefined}
                badge={
                  <span className="flex shrink-0 items-center gap-1.5">
                    {live && <span className="rounded bg-danger px-1 text-[10px] font-bold leading-4 text-on-danger">AO VIVO</span>}
                    {here.length > 0 && <span className="text-xs tabular-nums text-fg-subtle">{here.length}</span>}
                  </span>
                }
                trailing={canManage && <DeleteChannel onClick={() => setDialog({ kind: 'deleteChannel', channel: room })} />}
                // Clicking a room joins it (the call shows in the floating window); clicking the
                // room you're in opens the call in a panel.
                onClick={() => (mine ? expandCall(server.id) : void join(server.id, room.id))}
              />
            )
          })}
        </Section>

        <Section title="Conversas" collapsed={collapsed} onAdd={canManage ? () => setDialog({ kind: 'channel', type: 'text' }) : undefined}>
          {texts.map((channel) => {
            const tab = channelTab(channel.id)
            const read = reads[channel.id]
            const unread = read?.unread_count ?? 0
            const where = placeOf(tab)
            return (
              <Item
                key={channel.id}
                icon={Hash}
                label={channel.name ?? ''}
                collapsed={collapsed}
                active={where.active}
                panelHint={where.hint}
                dot={collapsed && unread > 0 ? 'accent' : undefined}
                badge={
                  read?.mention_count ? (
                    <CountBadge count={read.mention_count} tone="danger" />
                  ) : (
                    <CountBadge count={unread} />
                  )
                }
                trailing={canManage && <DeleteChannel onClick={() => setDialog({ kind: 'deleteChannel', channel })} />}
                dragTab={tab}
                onClick={() => openTab(server.id, tab)}
                onSide={() => openTab(server.id, tab, true)}
              />
            )
          })}
        </Section>

        <Section title="Addons" collapsed={collapsed}>
          {ADDONS.map((addon) => {
            const tab = addonTab(addon.key)
            const where = placeOf(tab)
            return (
              <Item
                key={addon.key}
                icon={addon.icon}
                label={addon.name}
                collapsed={collapsed}
                active={where.active}
                panelHint={where.hint}
                badge={<span className="shrink-0 text-[10px] font-semibold uppercase text-fg-subtle">em breve</span>}
                dragTab={tab}
                onClick={() => openTab(server.id, tab)}
                onSide={() => openTab(server.id, tab, true)}
              />
            )
          })}
        </Section>
      </div>

      {dialog?.kind === 'invite' && <InviteModal server={server} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'channel' && (
        <CreateChannelModal serverId={server.id} initialType={dialog.type} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'leave' && (
        <ConfirmModal
          title={`Sair de ${server.name}`}
          message="Você só volta com um novo convite."
          confirmLabel="Sair do servidor"
          onConfirm={() => api(`/servers/${server.id}/members/me`, { method: 'DELETE' })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmModal
          title={`Excluir ${server.name}`}
          message="Todos os canais e mensagens serão apagados para sempre."
          confirmLabel="Excluir servidor"
          onConfirm={() => api(`/servers/${server.id}`, { method: 'DELETE' })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'deleteChannel' && (
        <ConfirmModal
          title={`Excluir ${dialog.channel.type === 'text' ? '#' : ''}${dialog.channel.name}`}
          message={dialog.channel.type === 'text' ? 'Todas as mensagens do canal serão apagadas.' : 'A sala de voz será removida.'}
          confirmLabel="Excluir canal"
          onConfirm={() => api(`/channels/${dialog.channel.id}`, { method: 'DELETE' })}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  )
}

function DeleteChannel({ onClick }: { onClick(): void }): ReactNode {
  return (
    <button
      type="button"
      title="Excluir canal"
      aria-label="Excluir canal"
      onClick={onClick}
      className="hidden px-2 text-fg-subtle hover:text-danger group-hover:block"
    >
      <Trash2 size={14} />
    </button>
  )
}

function ServerHeader({
  server,
  collapsed,
  canManage,
  isOwner,
  onPick,
  onCollapse
}: {
  server: ServerDetail
  collapsed: boolean
  canManage: boolean
  isOwner: boolean
  onPick(d: Dialog): void
  onCollapse?: (c: boolean) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  const pick = (d: Dialog) => () => {
    setOpen(false)
    onPick(d)
  }

  const settingsButton = (
    <button
      type="button"
      title="Configurações do servidor"
      aria-label="Configurações do servidor"
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
      className="rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg"
    >
      {open ? <X size={18} /> : <Settings size={18} />}
    </button>
  )

  return (
    <div ref={ref} className="relative border-b border-line">
      {collapsed ? (
        <div className="flex flex-col items-center gap-1 py-2">
          <span title={server.name}>
            <ServerIcon name={server.name} url={server.icon_url} size={32} />
          </span>
          <CollapseButton collapsed onCollapse={onCollapse} />
        </div>
      ) : (
        <div className="flex h-12 items-center gap-1 pl-3 pr-1.5">
          <h2 className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold">{server.name}</h2>
          {settingsButton}
          <CollapseButton collapsed={false} onCollapse={onCollapse} />
        </div>
      )}
      {open && (
        <div className={`${menuClass} absolute left-2 right-2 top-[52px] min-w-[200px]`}>
          {/* Invites also create accounts, so only owners/admins can hand them out. */}
          {canManage && <MenuItem label="Convidar pessoas" onClick={pick({ kind: 'invite' })} />}
          {canManage && <MenuItem label="Criar canal" onClick={pick({ kind: 'channel', type: 'text' })} />}
          {canManage && <div className="my-1 h-px bg-line" />}
          {isOwner ? (
            <MenuItem label="Excluir servidor" danger onClick={pick({ kind: 'delete' })} />
          ) : (
            <MenuItem label="Sair do servidor" danger onClick={pick({ kind: 'leave' })} />
          )}
        </div>
      )}
    </div>
  )
}

/** Home sidebar: friends and direct messages (filled in by block 2.3). */
function HomePlaces({ collapsed, onCollapse }: { collapsed: boolean; onCollapse?: (c: boolean) => void }): ReactNode {
  return (
    <>
      <div className={`flex border-b border-line ${collapsed ? 'flex-col items-center gap-1 py-2' : 'h-12 items-center pl-3 pr-1.5'}`}>
        {!collapsed && <h2 className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold">Início</h2>}
        <CollapseButton collapsed={collapsed} onCollapse={onCollapse} />
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        <Item icon={Users} label="Amigos" collapsed={collapsed} active badge={<CountBadge count={0} />} onClick={() => {}} />
        {!collapsed && (
          <section>
            <div className="mb-1 flex items-center px-1">
              <h3 className="flex-1 font-sans text-xs font-semibold uppercase tracking-wide text-fg-subtle">Mensagens diretas</h3>
              <button
                type="button"
                disabled
                title="Novo grupo (em breve)"
                aria-label="Novo grupo"
                className="text-fg-subtle disabled:cursor-not-allowed disabled:opacity-50"
              >
                <MessageSquarePlus size={16} />
              </button>
            </div>
            <p className="px-2 py-3 text-sm text-fg-subtle">Suas conversas e grupos vão aparecer aqui.</p>
          </section>
        )}
      </div>
    </>
  )
}

function VoiceError({ collapsed }: { collapsed: boolean }): ReactNode {
  const error = useVoice((s) => s.error)
  const clearError = useVoice((s) => s.clearError)
  if (!error || collapsed) return null
  return (
    <div role="alert" className="flex items-start gap-2 border-t border-line bg-danger/15 px-3 py-2 text-xs">
      <span className="flex-1">{error}</span>
      <button type="button" onClick={clearError} className="text-fg-muted hover:text-fg" aria-label="Fechar">
        <X size={14} />
      </button>
    </div>
  )
}
