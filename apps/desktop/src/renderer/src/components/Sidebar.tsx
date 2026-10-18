import {
  ChevronDown,
  Hash,
  HeadphoneOff,
  LayoutDashboard,
  MicOff,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  Plus,
  Settings,
  SlidersHorizontal,
  Trash2,
  Users,
  Video,
  Volume2,
  X,
  type LucideIcon
} from 'lucide-react'
import { Fragment, useCallback, useRef, useState, type MouseEvent, type ReactNode } from 'react'

import { ADDONS } from '../addons/registry'
import { api, mediaUrl, type Channel, type Dm, type Me, type ServerDetail, type User, type VoiceState } from '../lib/api'
import { serverPeople } from '../lib/members'
import { basePermissions, channelPermissions, has, Perm } from '../lib/permissions'
import { useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { addonTab, channelTab, layoutOf, useNav, visiblePanels } from '../store/nav'
import { dmPeer, dmTitle, useSocial } from '../store/social'
import { useVoice } from '../store/voice'
import { CallCard } from './CallCard'
import { ChannelSettingsModal } from './ChannelSettings'
import { contextMenu } from './ContextMenu'
import { ConfirmModal, CreateChannelModal, InviteModal } from './modals'
import { PANEL_DRAG_TYPE } from './Panels'
import { ServerSettingsModal } from './ServerSettings'
import { COLUMNS, useColumnWidth } from './Resizer'
import { PickFriendsModal } from './socialModals'
import { Avatar, CountBadge, menuClass, MenuItem, PresenceAvatar, ServerIcon, useDismiss } from './ui'
import { LocallyMuted, UserMenu } from './UserMenu'

type Dialog =
  | { kind: 'invite' }
  | { kind: 'channel'; type: 'text' | 'voice' }
  | { kind: 'leave' }
  | { kind: 'delete' }
  | { kind: 'deleteChannel'; channel: Channel }
  | { kind: 'settings' }
  | { kind: 'channelSettings'; channel: Channel }

/** Left column: the current tab's places (server sections or Home), and the call card at the bottom. */
export function Sidebar({ server, me }: { server: ServerDetail | null; me: Me }): ReactNode {
  const saved = useAppearance((s) => s.settings.sidebar_collapsed)
  const narrow = useNav((s) => s.narrow)
  const setCollapsed = useNav((s) => s.setSidebarCollapsed)
  // A narrow window always shows icons only, without changing the saved choice.
  const collapsed = saved || narrow
  const { width, handle } = useColumnWidth(COLUMNS.sidebar, 'right')

  return (
    <aside style={collapsed ? undefined : { width }} className={`relative flex shrink-0 flex-col bg-panel ${collapsed ? 'w-[64px]' : ''}`}>
      {!collapsed && handle}
      {server ? (
        <ServerPlaces server={server} me={me} collapsed={collapsed} onCollapse={narrow ? undefined : setCollapsed} />
      ) : (
        <HomePlaces me={me} collapsed={collapsed} onCollapse={narrow ? undefined : setCollapsed} />
      )}
      <VoiceError collapsed={collapsed} />
      <CallCard collapsed={collapsed} meId={me.id} />
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
  addLabel,
  children
}: {
  title: string
  collapsed: boolean
  onAdd?: () => void
  /** What the + button does (default: create something in the section). */
  addLabel?: string
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
          <button type="button" title={addLabel ?? 'Criar'} aria-label={addLabel ?? `Criar em ${title}`} onClick={onAdd} className="text-fg-subtle hover:text-fg">
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
  const perms = basePermissions(server, me.id)
  const canCreateChannels = has(perms, Perm.MANAGE_CHANNELS)

  // Where each tab is showing: highlighted when it's a panel's active tab.
  const layout = layoutOf(server.id)
  const visible = visiblePanels(layout, focusedPanel, narrow)
  const placeOf = (tab: string): { active: boolean; hint?: string } => {
    const i = layout.panels.findIndex((p) => p.active === tab)
    if (i < 0 || !visible.includes(i)) return { active: false }
    return { active: true, hint: visible.length > 1 ? `${i + 1}/${visible.length}` : undefined }
  }

  const rooms = server.channels.filter((c) => c.type === 'voice')
  const people = serverPeople(server)
  const texts = server.channels.filter((c) => c.type === 'text')

  return (
    <>
      <ServerHeader
        server={server}
        collapsed={collapsed}
        perms={perms}
        isOwner={server.owner_id === me.id}
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

        <Section title="Salas" collapsed={collapsed} onAdd={canCreateChannels ? () => setDialog({ kind: 'channel', type: 'voice' }) : undefined}>
          {rooms.map((room) => {
            const here = server.voice_states.filter((v) => v.channel_id === room.id)
            const live = here.some((v) => v.screen)
            const mine = callChannelId === room.id
            return (
              <Fragment key={room.id}>
                <Item
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
                  trailing={<ChannelActions server={server} channel={room} meId={me.id} onPick={setDialog} />}
                  // Clicking a room joins it (the call shows in the floating window); clicking the
                  // room you're in opens the call in a panel.
                  onClick={() => (mine ? expandCall(server.id) : void join(server.id, room.id))}
                />
                {!collapsed && here.length > 0 && <RoomPeople states={here} people={people} mine={mine} meId={me.id} />}
              </Fragment>
            )
          })}
        </Section>

        <Section title="Conversas" collapsed={collapsed} onAdd={canCreateChannels ? () => setDialog({ kind: 'channel', type: 'text' }) : undefined}>
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
                trailing={<ChannelActions server={server} channel={channel} meId={me.id} onPick={setDialog} />}
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
      {dialog?.kind === 'settings' && <ServerSettingsModal server={server} meId={me.id} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'channelSettings' && (
        <ChannelSettingsModal
          server={server}
          channel={server.channels.find((c) => c.id === dialog.channel.id) ?? dialog.channel}
          meId={me.id}
          onClose={() => setDialog(null)}
        />
      )}
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

/** Hover buttons of a channel: its settings and delete, when the user may use them. */
function ChannelActions({
  server,
  channel,
  meId,
  onPick
}: {
  server: ServerDetail
  channel: Channel
  meId: string
  onPick(d: Dialog): void
}): ReactNode {
  const perms = channelPermissions(server, channel, meId)
  const canEdit = has(perms, Perm.MANAGE_CHANNELS)
  if (!canEdit && !has(perms, Perm.MANAGE_ROLES)) return null
  return (
    <span className="hidden items-center pr-1 group-hover:flex">
      <button
        type="button"
        title="Configurações do canal"
        aria-label="Configurações do canal"
        onClick={() => onPick({ kind: 'channelSettings', channel })}
        className="p-1 text-fg-subtle hover:text-fg"
      >
        <SlidersHorizontal size={14} />
      </button>
      {canEdit && (
        <button
          type="button"
          title="Excluir canal"
          aria-label="Excluir canal"
          onClick={() => onPick({ kind: 'deleteChannel', channel })}
          className="p-1 text-fg-subtle hover:text-danger"
        >
          <Trash2 size={14} />
        </button>
      )}
    </span>
  )
}

function ServerHeader({
  server,
  collapsed,
  perms,
  isOwner,
  onPick,
  onCollapse
}: {
  server: ServerDetail
  collapsed: boolean
  /** The user's server-wide permissions. */
  perms: number
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

  const banner = mediaUrl(server.banner_url)
  const canInvite = has(perms, Perm.CREATE_INVITE)
  const canCreate = has(perms, Perm.MANAGE_CHANNELS)
  const canSettings = has(perms, Perm.MANAGE_SERVER | Perm.MANAGE_ROLES | Perm.KICK_MEMBERS | Perm.BAN_MEMBERS)

  const settingsButton = (
    <button
      type="button"
      title="Menu do servidor"
      aria-label="Menu do servidor"
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
      ) : banner ? (
        // The banner on top, with the name over it.
        <div style={{ backgroundImage: `url("${banner}")` }} className="relative h-28 bg-cover bg-center">
          <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-scrim/85 via-scrim/20 to-transparent" />
          <div className="absolute right-1.5 top-1.5 flex gap-1 [&_button]:bg-scrim/50 [&_button]:text-on-scrim">
            {settingsButton}
            <CollapseButton collapsed={false} onCollapse={onCollapse} />
          </div>
          <h2 className="absolute inset-x-3 bottom-2 truncate font-display text-[15px] font-semibold text-on-scrim">{server.name}</h2>
        </div>
      ) : (
        <div className="flex h-12 items-center gap-1 pl-3 pr-1.5">
          <h2 className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold">{server.name}</h2>
          {settingsButton}
          <CollapseButton collapsed={false} onCollapse={onCollapse} />
        </div>
      )}
      {open && (
        <div className={`${menuClass} absolute left-2 right-2 top-full mt-1 min-w-[200px]`}>
          {canSettings && <MenuItem label="Configurações do servidor" onClick={pick({ kind: 'settings' })} />}
          {/* Invites also create accounts, so @everyone can't hand them out by default. */}
          {canInvite && <MenuItem label="Convidar pessoas" onClick={pick({ kind: 'invite' })} />}
          {canCreate && <MenuItem label="Criar canal" onClick={pick({ kind: 'channel', type: 'text' })} />}
          {(canSettings || canInvite || canCreate) && <div className="my-1 h-px bg-line" />}
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

/** Home sidebar: friends, then DMs and groups by latest activity. */
function HomePlaces({ me, collapsed, onCollapse }: { me: Me; collapsed: boolean; onCollapse?: (c: boolean) => void }): ReactNode {
  const homePage = useNav((s) => s.homePage)
  const openHome = useNav((s) => s.openHome)
  const pending = useSocial((s) => Object.values(s.friends).filter((f) => f.kind === 'incoming').length)
  const dms = useSocial((s) => s.dms)
  const createGroup = useSocial((s) => s.createGroup)
  const [creating, setCreating] = useState(false)
  const [leaving, setLeaving] = useState<Dm | null>(null)
  const list = Object.values(dms).sort((a, b) => b.last_message_id - a.last_message_id)

  return (
    <>
      <div className={`flex border-b border-line ${collapsed ? 'flex-col items-center gap-1 py-2' : 'h-12 items-center pl-3 pr-1.5'}`}>
        {!collapsed && <h2 className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold">Início</h2>}
        <CollapseButton collapsed={collapsed} onCollapse={onCollapse} />
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        <Item
          icon={Users}
          label="Amigos"
          collapsed={collapsed}
          active={homePage === 'friends'}
          dot={collapsed && pending > 0 ? 'accent' : undefined}
          badge={<CountBadge count={pending} tone="danger" />}
          onClick={() => openHome('friends')}
        />
        <Section title="Mensagens diretas" collapsed={collapsed} onAdd={() => setCreating(true)} addLabel="Novo grupo">
          {list.map((dm) => (
            <DmItem
              key={dm.id}
              dm={dm}
              meId={me.id}
              collapsed={collapsed}
              active={homePage === dm.id}
              onOpen={() => openHome(dm.id)}
              onClose={() => (dm.type === 'dm' ? void useSocial.getState().closeDm(dm.id).catch(() => {}) : setLeaving(dm))}
            />
          ))}
          {list.length === 0 && !collapsed && <p className="px-2 py-3 text-sm text-fg-subtle">Suas conversas e grupos aparecem aqui.</p>}
        </Section>
      </div>
      {creating && (
        <PickFriendsModal
          title="Novo grupo"
          confirmLabel="Criar grupo"
          withName
          onConfirm={async (ids, name) => openHome((await createGroup(ids, name)).id)}
          onClose={() => setCreating(false)}
        />
      )}
      {leaving && (
        <ConfirmModal
          title={`Sair de ${dmTitle(leaving, me.id)}`}
          message="Você só volta se alguém do grupo te adicionar de novo."
          confirmLabel="Sair do grupo"
          onConfirm={() => useSocial.getState().closeDm(leaving.id)}
          onClose={() => setLeaving(null)}
        />
      )}
    </>
  )
}

function DmItem({
  dm,
  meId,
  collapsed,
  active,
  onOpen,
  onClose
}: {
  dm: Dm
  meId: string
  collapsed: boolean
  active: boolean
  onOpen(): void
  onClose(): void
}): ReactNode {
  const unread = useChat((s) => s.reads[dm.id]?.unread_count ?? 0)
  const peer = dmPeer(dm, meId)
  const status = useSocial((s) => (peer ? (s.presence[peer.id] ?? 'offline') : undefined))
  const title = dmTitle(dm, meId)
  const live = !!dm.call && dm.voice_states.length > 0
  const closeLabel = dm.type === 'dm' ? 'Fechar conversa' : 'Sair do grupo'

  return (
    <div
      className={`group relative flex items-center rounded-item ${
        active ? 'bg-elevated text-fg' : unread ? 'text-fg hover:bg-elevated/60' : 'text-fg-muted hover:bg-elevated/60 hover:text-fg'
      }`}
    >
      <button
        type="button"
        title={collapsed ? title : undefined}
        aria-label={collapsed ? title : undefined}
        onClick={onOpen}
        className={`flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left ${collapsed ? 'justify-center px-0' : 'px-2'}`}
      >
        <span className="relative shrink-0">
          {peer ? (
            <PresenceAvatar name={peer.display_name} url={peer.avatar_url} status={status} size={28} border={active ? 'border-elevated' : 'border-panel'} />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-elevated text-fg-muted">
              <Users size={15} />
            </span>
          )}
          {collapsed && unread > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-panel bg-danger" />}
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{title}</span>
            {dm.type === 'group_dm' && <span className="block text-xs text-fg-subtle">{dm.members.length} pessoas</span>}
          </span>
        )}
        {!collapsed && live && (
          <span title="Chamada em andamento" className="shrink-0 text-success">
            <Phone size={14} />
          </span>
        )}
        {!collapsed && <CountBadge count={unread} tone="danger" />}
      </button>
      {!collapsed && (
        <button
          type="button"
          title={closeLabel}
          aria-label={closeLabel}
          onClick={onClose}
          className="hidden px-2 text-fg-subtle hover:text-fg group-hover:block"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

/** Who's in a room, under it: speaking ring (in our own room), mute, deafen, camera and live. */
function RoomPeople({
  states,
  people,
  mine,
  meId
}: {
  states: VoiceState[]
  people: Map<string, User>
  mine: boolean
  meId: string
}): ReactNode {
  // Who's speaking is only known inside our own call.
  const speaking = useVoice((s) => (mine ? s.speaking : null))
  return (
    <ul aria-label="Na sala" className="mb-1 ml-6 space-y-px">
      {states.map((v) => {
        const user = people.get(v.user_id)
        const name = user?.display_name ?? 'Alguém'
        return (
          <li
            key={v.user_id}
            onContextMenu={user ? contextMenu(() => <UserMenu user={user} meId={meId} />) : undefined}
            className="flex items-center gap-2 rounded-item px-1.5 py-0.5 text-fg-muted hover:bg-elevated/60 hover:text-fg"
          >
            <span className={`shrink-0 rounded-full ring-offset-1 ring-offset-panel ${speaking?.includes(v.user_id) ? 'ring-2 ring-accent' : ''}`}>
              <Avatar name={name} url={user?.avatar_url} size={20} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px]">{name}</span>
            {v.screen && <span className="shrink-0 rounded bg-danger px-1 text-[9px] font-bold leading-4 text-on-danger">AO VIVO</span>}
            {v.camera && <Video size={13} aria-label="Câmera ligada" className="shrink-0" />}
            {v.user_id !== meId && <LocallyMuted userId={v.user_id} size={13} />}
            {v.deafened ? (
              <HeadphoneOff size={13} aria-label={v.server_deafened ? 'Áudio desativado pelo servidor' : 'Sem áudio'} className={`shrink-0 ${v.server_deafened ? 'text-danger' : ''}`} />
            ) : (
              v.muted && <MicOff size={13} aria-label={v.server_muted ? 'Silenciado pelo servidor' : 'Microfone desligado'} className={`shrink-0 ${v.server_muted ? 'text-danger' : ''}`} />
            )}
          </li>
        )
      })}
    </ul>
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
