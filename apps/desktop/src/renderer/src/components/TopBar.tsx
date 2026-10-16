import { Bell, Check, Circle, House, LogOut, PhoneMissed, Plus, Search, Settings, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import type { Me, Presence, ServerDetail, UserStatus } from '../lib/api'
import { useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { serverTabs, useNav } from '../store/nav'
import { dmTitle, useSocial } from '../store/social'
import { Modal } from './Modal'
import { AddServerModal } from './modals'
import { ProfilePopover } from './ProfileCard'
import { SettingsModal } from './SettingsModal'
import { Avatar, CountBadge, menuClass, MenuItem, ServerIcon, StatusDot, useDismiss } from './ui'

const TAB_DRAG_TYPE = 'application/x-aureum-server-tab'

/** Logo, the Home tab, one tab per open server, then search, notifications and the profile menu. */
export function TopBar({ me }: { me: Me }): ReactNode {
  const servers = useChat((s) => s.servers)
  const order = useChat((s) => s.order)
  const tabOrder = useAppearance((s) => s.settings.tab_order)
  const closed = useAppearance((s) => s.settings.closed_tabs)
  const place = useNav((s) => s.place)
  const [searching, setSearching] = useState(false)
  const tabs = serverTabs(order, tabOrder, closed).filter((id) => servers[id])

  // Ctrl+K opens the global search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearching(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <header className="flex h-12 shrink-0 items-end gap-1 bg-rail px-2 pt-1.5">
      <Brand />
      <nav aria-label="Abas" className="no-scrollbar flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
        <HomeTab active={place === 'home'} />
        {tabs.map((id) => (
          <ServerTab key={id} server={servers[id]} active={place === id} tabs={tabs} />
        ))}
        <EndDropZone tabs={tabs} />
        <AddServerButton closed={closed.filter((id) => servers[id])} />
      </nav>

      <div className="flex shrink-0 items-center gap-1 self-center pb-1.5 pl-2">
        <button
          type="button"
          onClick={() => setSearching(true)}
          className="hidden items-center gap-2 rounded-control border border-line bg-panel px-3 py-1.5 text-sm text-fg-subtle hover:text-fg md:flex"
        >
          <Search size={16} />
          Buscar
          <kbd className="rounded bg-elevated px-1.5 font-sans text-[11px] text-fg-muted">Ctrl K</kbd>
        </button>
        <button
          type="button"
          title="Buscar (Ctrl K)"
          aria-label="Buscar"
          onClick={() => setSearching(true)}
          className="rounded-item p-2 text-fg-muted hover:bg-elevated hover:text-fg md:hidden"
        >
          <Search size={18} />
        </button>
        <NotificationsButton me={me} />
        <ProfileButton me={me} />
      </div>

      {searching && <SearchPlaceholder onClose={() => setSearching(false)} />}
    </header>
  )
}

function Brand(): ReactNode {
  return (
    <div className="mb-1.5 mr-2 flex shrink-0 items-center gap-2 self-center pl-1">
      <span className="flex h-7 w-7 items-center justify-center rounded-item bg-accent font-display text-sm font-bold text-on-accent">A</span>
      <span className="hidden font-display text-[15px] font-semibold tracking-tight lg:inline">Aureum</span>
    </div>
  )
}

const tabBase =
  'group relative flex h-[38px] shrink-0 items-center gap-2 rounded-t-control px-3 text-sm font-medium transition-colors'
const tabState = (active: boolean): string =>
  active ? 'bg-panel text-fg' : 'text-fg-muted hover:bg-panel/50 hover:text-fg'

/** Friend requests waiting for an answer, plus unread DM and group messages (missed calls
 * included: each leaves an unread line in its conversation). */
function useHomePending(): number {
  const requests = useSocial((s) => Object.values(s.friends).filter((f) => f.kind === 'incoming').length)
  const dms = useSocial((s) => s.dms)
  const unread = useChat((s) => Object.keys(dms).reduce((n, id) => n + (s.reads[id]?.unread_count ?? 0), 0))
  return requests + unread
}

function HomeTab({ active }: { active: boolean }): ReactNode {
  const go = useNav((s) => s.go)
  const pending = useHomePending()
  return (
    <button type="button" onClick={() => go('home')} aria-current={active ? 'page' : undefined} className={`${tabBase} ${tabState(active)}`}>
      <House size={17} />
      <span>Início</span>
      <CountBadge count={pending} tone="danger" />
    </button>
  )
}

function ServerTab({ server, active, tabs }: { server: ServerDetail; active: boolean; tabs: string[] }): ReactNode {
  const openServer = useNav((s) => s.openServer)
  const closeServerTab = useNav((s) => s.closeServerTab)
  const moveServerTab = useNav((s) => s.moveServerTab)
  const mentions = useChat((s) => server.channels.reduce((n, c) => n + (s.reads[c.id]?.mention_count ?? 0), 0))
  const live = server.voice_states.some((v) => v.screen)
  const [dropTarget, setDropTarget] = useState(false)

  const onDrop = (e: DragEvent): void => {
    setDropTarget(false)
    const id = e.dataTransfer.getData(TAB_DRAG_TYPE)
    if (id && id !== server.id) moveServerTab(id, server.id, tabs)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      title={server.name}
      aria-current={active ? 'page' : undefined}
      onClick={() => openServer(server.id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openServer(server.id)}
      onAuxClick={(e) => e.button === 1 && closeServerTab(server.id, tabs)}
      onDragStart={(e) => {
        e.dataTransfer.setData(TAB_DRAG_TYPE, server.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TAB_DRAG_TYPE)) return
        e.preventDefault()
        setDropTarget(true)
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={onDrop}
      className={`${tabBase} ${tabState(active)} max-w-[220px] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent`}
    >
      {dropTarget && <span className="absolute inset-y-1 -left-1 w-0.5 rounded bg-accent" />}
      <span className="relative">
        <ServerIcon name={server.name} url={server.icon_url} size={22} />
        {live && (
          <span title="Alguém está transmitindo" className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-rail bg-danger" />
        )}
      </span>
      <span className="truncate">{server.name}</span>
      <CountBadge count={mentions} tone="danger" />
      <button
        type="button"
        title="Fechar aba"
        aria-label={`Fechar aba de ${server.name}`}
        onClick={(e) => {
          e.stopPropagation()
          closeServerTab(server.id, tabs)
        }}
        className={`-mr-1 rounded p-0.5 text-fg-subtle hover:bg-elevated hover:text-fg ${active ? '' : 'opacity-0 group-hover:opacity-100'}`}
      >
        <X size={14} />
      </button>
    </div>
  )
}

/** Dropping a tab past the last one moves it to the end. */
function EndDropZone({ tabs }: { tabs: string[] }): ReactNode {
  const moveServerTab = useNav((s) => s.moveServerTab)
  return (
    <div
      className="h-[38px] w-3 shrink-0"
      onDragOver={(e) => e.dataTransfer.types.includes(TAB_DRAG_TYPE) && e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(TAB_DRAG_TYPE)
        if (id) moveServerTab(id, null, tabs)
      }}
    />
  )
}

function AddServerButton({ closed }: { closed: string[] }): ReactNode {
  const servers = useChat((s) => s.servers)
  const openServer = useNav((s) => s.openServer)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)

  return (
    <div ref={ref} className="relative mb-1.5 shrink-0 self-center">
      <button
        type="button"
        title="Abrir, criar ou entrar em um servidor"
        aria-label="Abrir, criar ou entrar em um servidor"
        aria-expanded={open}
        onClick={() => (closed.length ? setOpen((v) => !v) : setAdding(true))}
        className="flex h-8 w-8 items-center justify-center rounded-item text-fg-muted hover:bg-elevated hover:text-accent-text"
      >
        <Plus size={18} />
      </button>
      {open && (
        <div className={`${menuClass} fixed mt-1 w-64`}>
          <MenuItem
            icon={Plus}
            label="Criar ou entrar em um servidor"
            onClick={() => {
              setOpen(false)
              setAdding(true)
            }}
          />
          <div className="my-1 h-px bg-line" />
          <p className="px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Abrir de novo</p>
          {closed.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setOpen(false)
                openServer(id)
              }}
              className="flex w-full items-center gap-2.5 rounded-item px-2 py-1.5 text-left text-sm text-fg-muted hover:bg-elevated hover:text-fg"
            >
              <ServerIcon name={servers[id].name} url={servers[id].icon_url} size={22} />
              <span className="truncate">{servers[id].name}</span>
            </button>
          ))}
        </div>
      )}
      {adding && <AddServerModal onClose={() => setAdding(false)} />}
    </div>
  )
}

const missedFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Friend requests to answer and missed calls. */
function NotificationsButton({ me }: { me: Me }): ReactNode {
  const friends = useSocial((s) => s.friends)
  const missed = useSocial((s) => s.missed)
  const dms = useSocial((s) => s.dms)
  const { accept, remove } = useSocial.getState()
  const openHome = useNav((s) => s.openHome)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  const requests = Object.values(friends).filter((f) => f.kind === 'incoming')
  const count = requests.length + missed.length
  const go = (page: string): void => {
    setOpen(false)
    openHome(page)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Notificações"
        aria-label={count ? `Notificações (${count})` : 'Notificações'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-item p-2 text-fg-muted hover:bg-elevated hover:text-fg"
      >
        <Bell size={18} />
        {count > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger" />}
      </button>
      {open && (
        <div className={`${menuClass} absolute right-0 top-full mt-1 w-80`}>
          {count === 0 ? (
            <div className="p-3 text-center">
              <Bell size={28} className="mx-auto text-fg-subtle" />
              <p className="mt-2 font-medium">Nenhuma notificação</p>
              <p className="mt-1 text-sm text-fg-muted">Pedidos de amizade e chamadas perdidas aparecem aqui.</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {requests.length > 0 && <p className="px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Pedidos de amizade</p>}
              {requests.map((f) => (
                <div key={f.user.id} className="flex items-center gap-2.5 rounded-item px-2 py-1.5">
                  <Avatar name={f.user.display_name} url={f.user.avatar_url} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{f.user.display_name}</div>
                    <div className="truncate text-xs text-fg-subtle">@{f.user.username}</div>
                  </div>
                  <button
                    type="button"
                    title="Aceitar"
                    aria-label={`Aceitar ${f.user.display_name}`}
                    onClick={() => void accept(f.user.id).catch(() => {})}
                    className="rounded-full bg-elevated p-1.5 text-fg-muted hover:text-success"
                  >
                    <Check size={16} />
                  </button>
                  <button
                    type="button"
                    title="Recusar"
                    aria-label={`Recusar ${f.user.display_name}`}
                    onClick={() => void remove(f.user.id).catch(() => {})}
                    className="rounded-full bg-elevated p-1.5 text-fg-muted hover:text-danger"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              {missed.length > 0 && <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Chamadas perdidas</p>}
              {missed.map((call) => {
                const dm = dms[call.channel_id]
                const caller = dm?.members.find((m) => m.user.id === call.started_by)?.user
                return (
                  <button
                    key={call.id}
                    type="button"
                    onClick={() => go(call.channel_id)}
                    className="flex w-full items-center gap-2.5 rounded-item px-2 py-1.5 text-left hover:bg-elevated"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
                      <PhoneMissed size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{caller?.display_name ?? 'Alguém'}</span>
                      <span className="block truncate text-xs text-fg-subtle">
                        {dm && dm.type === 'group_dm' ? `${dmTitle(dm, me.id)} · ` : ''}
                        {missedFmt.format(new Date(call.started_at))}
                      </span>
                    </span>
                  </button>
                )
              })}
              {requests.length > 0 && (
                <button
                  type="button"
                  onClick={() => go('friends')}
                  className="mt-1 w-full rounded-item px-2 py-1.5 text-left text-sm text-accent-text hover:bg-elevated"
                >
                  Ver todos os amigos
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const STATUS_OPTIONS: { value: UserStatus; label: string; hint?: string; dot: Presence }[] = [
  { value: 'online', label: 'Online', dot: 'online' },
  { value: 'idle', label: 'Ausente', dot: 'idle' },
  { value: 'dnd', label: 'Não perturbe', hint: 'Sem toques nem sons', dot: 'dnd' },
  { value: 'invisible', label: 'Invisível', hint: 'Aparece offline', dot: 'offline' }
]

function ProfileButton({ me }: { me: Me }): ReactNode {
  const { logout } = useAuth()
  const status = useChat((s) => s.status)
  const chosen = useAppearance((s) => s.settings.status)
  const setStatus = (value: UserStatus): void => useAppearance.getState().update({ status: value })
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState(false)
  const [profile, setProfile] = useState<DOMRect | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  const connected = status === 'online'
  const dot: Presence = connected ? (STATUS_OPTIONS.find((o) => o.value === chosen)?.dot ?? 'online') : 'offline'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Menu do perfil"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-control py-1 pl-1 pr-2 hover:bg-elevated"
      >
        <span className="relative">
          <Avatar name={me.display_name} url={me.avatar_url} size={28} />
          <span title={connected ? undefined : 'Reconectando…'} className="absolute -bottom-0.5 -right-0.5">
            <StatusDot status={dot} border="border-rail" />
          </span>
        </span>
        <span className="hidden max-w-[140px] truncate text-sm font-semibold lg:inline">{me.display_name}</span>
      </button>
      {open && (
        <div className={`${menuClass} absolute right-0 top-full mt-1 w-60`}>
          <div className="px-2 pb-2 pt-1">
            <div className="truncate font-semibold">{me.display_name}</div>
            <div className="truncate text-xs text-fg-subtle">@{me.username}</div>
          </div>
          <MenuItem
            icon={UserRound}
            label="Ver perfil"
            onClick={() => {
              setOpen(false)
              setProfile(ref.current?.getBoundingClientRect() ?? null)
            }}
          />
          <div className="my-1 h-px bg-line" />
          <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Status</p>
          {STATUS_OPTIONS.map((o) => (
            <StatusItem key={o.value} label={o.label} hint={o.hint} dot={o.dot} current={chosen === o.value} onClick={() => setStatus(o.value)} />
          ))}
          <div className="my-1 h-px bg-line" />
          <MenuItem
            icon={Settings}
            label="Configurações"
            onClick={() => {
              setOpen(false)
              setSettings(true)
            }}
          />
          <MenuItem icon={LogOut} label="Sair" danger onClick={() => void logout()} />
        </div>
      )}
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
      {profile && (
        <ProfilePopover
          user={me}
          anchor={new DOMRect(profile.right - 300 - 8, profile.bottom + 8, 0, 0)}
          onClose={() => setProfile(null)}
        />
      )}
    </div>
  )
}

function StatusItem({
  label,
  hint,
  dot,
  current,
  onClick
}: {
  label: string
  hint?: string
  dot: Presence
  current: boolean
  onClick(): void
}): ReactNode {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={current}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-item px-2 py-1.5 text-left text-sm hover:bg-elevated ${current ? 'text-fg' : 'text-fg-muted hover:text-fg'}`}
    >
      <StatusDot status={dot} size={10} border="border-transparent" />
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-fg-subtle">{hint}</span>}
      </span>
      {current && <Circle size={8} className="fill-current text-accent-text" />}
    </button>
  )
}

function SearchPlaceholder({ onClose }: { onClose(): void }): ReactNode {
  return (
    <Modal title="Buscar" onClose={onClose}>
      <div className="flex items-center gap-2 rounded-control border border-line bg-main px-3 py-2.5 text-fg-subtle">
        <Search size={18} />
        <span>Pessoas, servidores, canais e mensagens</span>
      </div>
      <p className="mt-4 text-center text-sm text-fg-muted">A busca global chega numa próxima versão.</p>
    </Modal>
  )
}
