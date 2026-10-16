import { Bell, Circle, House, LogOut, Plus, Search, Settings, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import type { Me, ServerDetail } from '../lib/api'
import { useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { serverTabs, useNav } from '../store/nav'
import { Modal } from './Modal'
import { AddServerModal } from './modals'
import { ProfilePopover } from './ProfileCard'
import { SettingsModal } from './SettingsModal'
import { Avatar, CountBadge, menuClass, MenuItem, ServerIcon, useDismiss } from './ui'

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
        <NotificationsButton />
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

function HomeTab({ active }: { active: boolean }): ReactNode {
  const go = useNav((s) => s.go)
  // Pending friend requests, unread DMs and missed calls arrive with block 2.3.
  const pending = 0
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

function NotificationsButton(): ReactNode {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Notificações"
        aria-label="Notificações"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-item p-2 text-fg-muted hover:bg-elevated hover:text-fg"
      >
        <Bell size={18} />
      </button>
      {open && (
        <div className={`${menuClass} absolute right-0 top-full mt-1 w-72 p-4 text-center`}>
          <Bell size={28} className="mx-auto text-fg-subtle" />
          <p className="mt-2 font-medium">Nenhuma notificação</p>
          <p className="mt-1 text-sm text-fg-muted">Pedidos de amizade e chamadas perdidas vão aparecer aqui.</p>
        </div>
      )}
    </div>
  )
}

function ProfileButton({ me }: { me: Me }): ReactNode {
  const { logout } = useAuth()
  const status = useChat((s) => s.status)
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState(false)
  const [profile, setProfile] = useState<DOMRect | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  const online = status === 'online'

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
          <span
            title={online ? 'Online' : 'Reconectando…'}
            className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-rail ${online ? 'bg-success' : 'bg-fg-subtle'}`}
          />
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
          <StatusItem label="Online" tone="bg-success" current />
          {/* Away, do not disturb and invisible come with presence in block 2.3. */}
          <StatusItem label="Ausente" tone="bg-idle" />
          <StatusItem label="Não perturbe" tone="bg-dnd" />
          <StatusItem label="Invisível" tone="bg-fg-subtle" />
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

function StatusItem({ label, tone, current = false }: { label: string; tone: string; current?: boolean }): ReactNode {
  return (
    <div
      aria-disabled={!current}
      title={current ? undefined : 'Em breve'}
      className={`flex items-center gap-2.5 rounded-item px-2 py-1.5 text-sm ${current ? 'text-fg' : 'cursor-not-allowed text-fg-muted opacity-50'}`}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${tone}`} />
      <span className="flex-1">{label}</span>
      {current && <Circle size={8} className="fill-current text-accent-text" />}
      {!current && <span className="text-xs">em breve</span>}
    </div>
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
