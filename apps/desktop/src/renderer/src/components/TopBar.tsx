import { Bell, Bug, Check, Circle, Compass, Download, House, LogOut, MessageSquareText, PhoneMissed, Plus, Sparkles, RefreshCw, Search, Settings, UserRound, Users, Volume2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { type Me, type Presence, type ServerDetail, type UserStatus } from '../lib/api'
import { shortcut } from '../lib/platform'
import { useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { useOnboarding } from '../store/onboarding'
import { serverTabs, useMembersBar, useNav } from '../store/nav'
import { dmTitle, useSocial } from '../store/social'
import { contextMenu } from './ContextMenu'
import { Logo } from './Logo'
import { Modal } from './Modal'
import { AddServerModal } from './modals'
import { ServerMenu } from './PlaceMenus'
import { ServerBannerLayer } from './ServerBanner'
import { CustomStatusModal } from './CustomStatus'
import { ProfilePopover } from './ProfileCard'
import { openReportProblem } from './ReportProblem'
import { StatusBubble } from './profileBits'
import { NewsModal, useUnseenNews } from './NewsModal'
import { SettingsModal } from './SettingsModal'
import { Avatar, CountBadge, menuClass, MenuItem, ServerIcon, StatusDot, useDismiss } from './ui'
import { userContextMenu } from './UserMenu'
import type { UpdateState } from '../../../shared/types'
import { t } from '../lib/i18n'

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
    // Empty parts of the bar move the window; Windows' buttons sit over its right end.
    <header className="app-drag pr-window-controls flex h-12 shrink-0 items-end gap-1 bg-rail pl-2 pt-1.5">
      <Brand />
      <nav aria-label={t('top.tabs')} data-tour="abas" className="no-scrollbar flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
        <HomeTab active={place === 'home'} />
        {tabs.map((id) => (
          <ServerTab key={id} server={servers[id]} active={place === id} tabs={tabs} meId={me.id} />
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
          {t('top.search')}
          <kbd className="rounded bg-elevated px-1.5 font-sans text-[11px] text-fg-muted">{shortcut('Ctrl K')}</kbd>
        </button>
        <button
          type="button"
          title={t('top.searchShortcut', { key: shortcut('Ctrl K') })}
          aria-label={t('top.search')}
          onClick={() => setSearching(true)}
          className="rounded-item p-2 text-fg-muted hover:bg-elevated hover:text-fg md:hidden"
        >
          <Search size={18} />
        </button>
        {place !== 'home' && <MembersButton serverId={place} />}
        <UpdateButton />
        <NotificationsButton me={me} />
        <ProfileButton me={me} />
      </div>

      {searching && <SearchPlaceholder onClose={() => setSearching(false)} />}
    </header>
  )
}

/** Opens the current server's member bar; its fixed place, whatever the panels show. */
function MembersButton({ serverId }: { serverId: string }): ReactNode {
  const open = useMembersBar(serverId)
  return (
    <button
      type="button"
      data-members-toggle
      data-tour="membros"
      title={t('top.membersShortcut', { key: shortcut('Ctrl Shift U') })}
      aria-label={t('top.members')}
      aria-pressed={open}
      onClick={() => useNav.getState().toggleMembers(serverId)}
      className={`rounded-item p-2 hover:bg-elevated hover:text-fg ${open ? 'text-fg' : 'text-fg-muted'}`}
    >
      <Users size={18} />
    </button>
  )
}

function Brand(): ReactNode {
  return (
    <div className="mb-1.5 mr-2 flex shrink-0 items-center gap-2 self-center pl-1">
      <Logo size={30} className="text-accent-text" />
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
  const muted = useAppearance((s) => s.settings.muted_places)
  const unread = useChat((s) => Object.keys(dms).reduce((n, id) => n + (muted.includes(id) ? 0 : (s.reads[id]?.unread_count ?? 0)), 0))
  return requests + unread
}

function HomeTab({ active }: { active: boolean }): ReactNode {
  const go = useNav((s) => s.go)
  const pending = useHomePending()
  return (
    <button type="button" onClick={() => go('home')} aria-current={active ? 'page' : undefined} className={`${tabBase} ${tabState(active)}`}>
      <House size={17} />
      <span>{t('top.home')}</span>
      <CountBadge count={pending} tone="danger" />
    </button>
  )
}

function ServerTab({ server, active, tabs, meId }: { server: ServerDetail; active: boolean; tabs: string[]; meId: string }): ReactNode {
  const openServer = useNav((s) => s.openServer)
  const closeServerTab = useNav((s) => s.closeServerTab)
  const moveServerTab = useNav((s) => s.moveServerTab)
  const mentions = useChat((s) => server.channels.reduce((n, c) => n + (s.reads[c.id]?.mention_count ?? 0), 0))
  const live = server.voice_states.some((v) => v.screen)
  const [dropTarget, setDropTarget] = useState(false)
  const preview = useHoverPreview()

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
      aria-label={server.name}
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
      onContextMenu={contextMenu(() => <ServerMenu server={server} meId={meId} tabs={tabs} />)}
      onMouseEnter={preview.show}
      onMouseLeave={preview.hide}
      onMouseDown={preview.hide}
      className={`${tabBase} ${tabState(active)} max-w-[220px] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent`}
    >
      {preview.anchor && <ServerPreview server={server} anchor={preview.anchor} />}
      {dropTarget && <span className="absolute inset-y-1 -left-1 w-0.5 rounded bg-accent" />}
      <span className="relative">
        <ServerIcon name={server.name} url={server.icon_url} size={22} />
        {live && (
          <span title={t('top.streaming')} className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-rail bg-danger" />
        )}
      </span>
      <span className="truncate">{server.name}</span>
      <CountBadge count={mentions} tone="danger" />
      <button
        type="button"
        title={t('top.closeTab')}
        aria-label={t('top.closeTabOf', { name: server.name })}
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

const PREVIEW_DELAY_MS = 450

/** Shows a preview after the pointer rests on an element for a moment. */
function useHoverPreview(): { anchor: DOMRect | null; show(e: MouseEvent): void; hide(): void } {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return {
    anchor,
    show: (e) => {
      const target = e.currentTarget as HTMLElement
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setAnchor(target.getBoundingClientRect()), PREVIEW_DELAY_MS)
    },
    hide: () => {
      clearTimeout(timer.current)
      setAnchor(null)
    }
  }
}

/** Hover card of a server tab: banner, icon, name, and who's around. */
function ServerPreview({ server, anchor }: { server: ServerDetail; anchor: DOMRect }): ReactNode {
  const online = server.members.filter((m) => m.online).length
  const inCall = server.voice_states.length
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 264 - 8))
  return (
    <div
      role="tooltip"
      style={{ left, top: anchor.bottom + 6 }}
      className="pointer-events-none fixed z-tooltip w-64 overflow-hidden rounded-panel border border-line bg-panel text-left shadow-2xl"
    >
      <div className="relative h-20 overflow-hidden">
        <ServerBannerLayer server={server} />
      </div>
      <div className="flex items-end gap-2.5 px-3 pb-3">
        <span className="-mt-6 rounded-item border-4 border-panel">
          <ServerIcon name={server.name} url={server.icon_url} size={40} />
        </span>
        <div className="min-w-0 flex-1 pt-1.5">
          <div className="truncate font-display font-semibold text-fg">{server.name}</div>
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            <span className="h-2 w-2 rounded-full bg-success" />
            {t('top.online', { count: online })}
            <span className="text-fg-subtle">·</span>
            <Volume2 size={12} />
            {t('top.inCall', { count: inCall })}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Dropping a tab past the last one moves it to the end. */
function EndDropZone({ tabs }: { tabs: string[] }): ReactNode {
  const moveServerTab = useNav((s) => s.moveServerTab)
  return (
    <div
      className="app-no-drag h-[38px] w-3 shrink-0"
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
        title={t('top.openServer')}
        aria-label={t('top.openServer')}
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
            label={t('top.createOrJoin')}
            onClick={() => {
              setOpen(false)
              setAdding(true)
            }}
          />
          <div className="my-1 h-px bg-line" />
          <p className="px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{t('top.reopen')}</p>
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

/** Friend requests to answer, missed calls and the notes of a new version. */
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
  const news = useUnseenNews()
  const [newsOpen, setNewsOpen] = useState(false)
  const count = requests.length + missed.length + (news.title ? 1 : 0)
  const go = (page: string): void => {
    setOpen(false)
    openHome(page)
  }

  return (
    <div ref={ref} data-tour="sino" className="relative">
      <button
        type="button"
        title={t('top.notifications')}
        aria-label={count ? t('top.notificationsCount', { count }) : t('top.notifications')}
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
              <p className="mt-2 font-medium">{t('top.noNotifications')}</p>
              <p className="mt-1 text-sm text-fg-muted">{t('top.noNotificationsHint')}</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {news.title && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    setNewsOpen(true)
                    news.markSeen()
                  }}
                  className="flex w-full items-center gap-2.5 rounded-item px-2 py-1.5 text-left hover:bg-elevated"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-text">
                    <Sparkles size={16} />
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium">{t('top.news', { title: news.title })}</span>
                </button>
              )}
              {requests.length > 0 && <p className="px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{t('top.requests')}</p>}
              {requests.map((f) => (
                <div key={f.user.id} onContextMenu={userContextMenu(f.user, me.id)} className="flex items-center gap-2.5 rounded-item px-2 py-1.5">
                  <Avatar name={f.user.display_name} url={f.user.avatar_url} gif={f.user.avatar_gif} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{f.user.display_name}</div>
                    <div className="truncate text-xs text-fg-subtle">@{f.user.username}</div>
                  </div>
                  <button
                    type="button"
                    title={t('top.accept')}
                    aria-label={t('top.acceptNamed', { name: f.user.display_name })}
                    onClick={() => void accept(f.user.id).catch(() => {})}
                    className="rounded-full bg-elevated p-1.5 text-fg-muted hover:text-success"
                  >
                    <Check size={16} />
                  </button>
                  <button
                    type="button"
                    title={t('top.decline')}
                    aria-label={t('top.declineNamed', { name: f.user.display_name })}
                    onClick={() => void remove(f.user.id).catch(() => {})}
                    className="rounded-full bg-elevated p-1.5 text-fg-muted hover:text-danger"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              {missed.length > 0 && <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{t('top.missed')}</p>}
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
                      <span className="block truncate text-sm font-medium">{caller?.display_name ?? t('top.someone')}</span>
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
                  {t('top.allFriends')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {newsOpen && <NewsModal onClose={() => setNewsOpen(false)} />}
    </div>
  )
}

/** Label and hint read in the app's language when shown (getters). */
const statusOption = (value: UserStatus, dot: Presence): { value: UserStatus; readonly label: string; readonly hint?: string; dot: Presence } => ({
  value,
  dot,
  get label() {
    return t(`system.status.${value}`)
  },
  get hint() {
    return value === 'dnd' || value === 'invisible' ? t(`top.statusHint.${value}`) : undefined
  }
})
const STATUS_OPTIONS = [statusOption('online', 'online'), statusOption('idle', 'idle'), statusOption('dnd', 'dnd'), statusOption('invisible', 'offline')]

function ProfileButton({ me }: { me: Me }): ReactNode {
  const { logout } = useAuth()
  const status = useChat((s) => s.status)
  const chosen = useAppearance((s) => s.settings.status)
  const setStatus = (value: UserStatus): void => useAppearance.getState().update({ status: value })
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState(false)
  const [statusEditor, setStatusEditor] = useState(false)
  const [profile, setProfile] = useState<DOMRect | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  const connected = status === 'online'
  const dot: Presence = connected ? (STATUS_OPTIONS.find((o) => o.value === chosen)?.dot ?? 'online') : 'offline'

  return (
    <div ref={ref} data-tour="perfil" className="relative">
      <button
        type="button"
        aria-label={t('top.profileMenu')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-control py-1 pl-1 pr-2 hover:bg-elevated"
      >
        <span className="relative">
          <Avatar name={me.display_name} url={me.avatar_url} gif={me.avatar_gif} size={28} />
          <span title={connected ? undefined : t('top.reconnecting')} className="absolute -bottom-0.5 -right-0.5">
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
            <StatusBubble user={me} tail="left" size="xs" className="ml-1 mt-1.5" />
          </div>
          <MenuItem
            icon={UserRound}
            label={t('top.viewProfile')}
            onClick={() => {
              setOpen(false)
              setProfile(ref.current?.getBoundingClientRect() ?? null)
            }}
          />
          <MenuItem
            icon={MessageSquareText}
            label={me.custom_status ? t('top.editStatus') : t('top.setStatus')}
            onClick={() => {
              setOpen(false)
              setStatusEditor(true)
            }}
          />
          <div className="my-1 h-px bg-line" />
          <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{t('top.status')}</p>
          {STATUS_OPTIONS.map((o) => (
            <StatusItem key={o.value} label={o.label} hint={o.hint} dot={o.dot} current={chosen === o.value} onClick={() => setStatus(o.value)} />
          ))}
          <div className="my-1 h-px bg-line" />
          <MenuItem
            icon={Settings}
            label={t('top.settings')}
            onClick={() => {
              setOpen(false)
              setSettings(true)
            }}
          />
          <MenuItem
            icon={Compass}
            label={t('top.tour')}
            onClick={() => {
              setOpen(false)
              useOnboarding.getState().startTour()
            }}
          />
          <MenuItem
            icon={Bug}
            label={t('top.report')}
            hint={shortcut('Ctrl+Shift+R')}
            onClick={() => {
              setOpen(false)
              void openReportProblem()
            }}
          />
          <MenuItem icon={LogOut} label={t('top.signOut')} danger onClick={() => void logout()} />
        </div>
      )}
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
      {statusEditor && <CustomStatusModal me={me} onClose={() => setStatusEditor(false)} />}
      {profile && (
        <ProfilePopover
          user={me}
          anchor={new DOMRect(profile.right - 340 - 8, profile.bottom + 8, 0, 0)}
          onClose={() => setProfile(null)}
        />
      )}
    </div>
  )
}

/** Shows up once an update finished downloading in the background; on the Mac, once a newer
 * version exists (it can't update itself: the button opens the download page). */
export function UpdateButton(): ReactNode {
  const [update, setUpdate] = useState<UpdateState | null>(null)
  useEffect(() => {
    void window.aureum.updates.getState().then((s) => s.ready && setUpdate(s))
    return window.aureum.updates.onReady(setUpdate)
  }, [])
  if (!update?.version) return null
  return (
    <button
      type="button"
      title={update.manual ? t('top.updateManual', { version: update.version }) : t('top.updateReady', { version: update.version })}
      onClick={() => void window.aureum.updates.install()}
      className="flex items-center gap-1.5 rounded-control bg-accent px-2.5 py-1 text-xs font-semibold text-on-accent hover:bg-accent-hover"
    >
      {update.manual ? (
        <>
          <Download size={14} /> {t('top.download', { version: update.version })}
        </>
      ) : (
        <>
          <RefreshCw size={14} /> {t('top.restart')}
        </>
      )}
    </button>
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
    <Modal title={t('top.search')} onClose={onClose}>
      <div className="flex items-center gap-2 rounded-control border border-line bg-main px-3 py-2.5 text-fg-subtle">
        <Search size={18} />
        <span>{t('top.searchHint')}</span>
      </div>
      <p className="mt-4 text-center text-sm text-fg-muted">{t('top.searchSoon')}</p>
    </Modal>
  )
}
