import { AtSign, CalendarDays, Gamepad2, Link2, MessageCircle, Phone, PhoneMissed, Plus, Radio, UserPlus, Volume2, X, type LucideIcon } from 'lucide-react'
import { Fragment, useEffect, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'

import type { Activity, Dm, Friend, HomeTask, Me, Message, Presence, ServerDetail, User } from '../lib/api'
import { messagePreview } from '../lib/attachments'
import { CHANGELOG, releaseNotes } from '../lib/changelog'
import { memberName } from '../lib/members'
import { channelPermissions, has, Perm } from '../lib/permissions'
import { useActivity } from '../store/activity'
import { useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { friendsInCall, liveRooms, useHome, usePendingItems, type LiveRoom, type PendingItem } from '../store/home'
import { channelTab, useNav } from '../store/nav'
import { dmPeer, dmTitle, useSocial } from '../store/social'
import { HOME_WATCH_MAX, useThumbnails, watchHome } from '../store/thumbnails'
import { useVoice } from '../store/voice'
import { Modal } from './Modal'
import { AddServerModal } from './modals'
import { activityLabel } from './profileBits'
import { AddFriendModal, StartCallModal } from './socialModals'
import { Avatar, CountBadge, GroupAvatar, PRESENCE_LABEL, PresenceAvatar, ServerIcon } from './ui'

const LIVE_PREVIEW = 6
const SIDE_COLUMN = 'flex flex-col gap-6 @min-[1000px]:w-[300px] @min-[1000px]:shrink-0'
const CARD_GRID = 'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]'

/** "Bom dia" from 5h, "Boa tarde" from 12h, "Boa noite" from 18h, by the PC's clock. */
export function greeting(now: Date = new Date()): string {
  const hour = now.getHours()
  if (hour >= 5 && hour < 12) return 'Bom dia'
  if (hour >= 12 && hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

/** The line under the greeting: friends in a call and things waiting, or all clear. */
export function hubSummary(inCall: number, pending: number): string {
  const parts = [
    inCall > 0 && `${inCall} ${inCall === 1 ? 'amigo' : 'amigos'} em call agora`,
    pending > 0 && `${pending} ${pending === 1 ? 'coisa esperando' : 'coisas esperando'} por você`
  ].filter(Boolean)
  return parts.length ? `${parts.join(' e ')}.` : 'Tudo em dia por aqui.'
}

/** How long a room has been going: "agora", "41 min", "1 h 5 min". */
export function liveFor(since: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000))
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
}

/** The current time, ticking every minute (for "41 min" labels). */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

type Dialog = 'call' | 'friend' | 'create' | 'join'

/** Home's hub: what matters right now, across servers, conversations and addons. */
export function HomeHub({ me }: { me: Me }): ReactNode {
  const [dialog, setDialog] = useState<Dialog | null>(null)
  // Loads the hub's own data, and keeps it live while it's on screen.
  useEffect(() => {
    useHome.getState().open()
    return () => useHome.getState().close()
  }, [])

  return (
    <div className="@container flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-8 py-7">
        <Header me={me} onDialog={setDialog} />
        {/* Two columns on wide windows, the right one as wide as the side column below it; under
            ~1000px everything stacks (servers under the live rooms, the side column at the end). */}
        <div className="flex flex-col gap-6 @min-[1000px]:flex-row @min-[1000px]:items-start">
          <div className="min-w-0 flex-1">
            <LiveNow me={me} onCall={() => setDialog('call')} />
          </div>
          <div className={SIDE_COLUMN}>
            <YourServers onAdd={() => setDialog('create')} />
          </div>
        </div>
        <div className="flex flex-col gap-6 @min-[1000px]:flex-row @min-[1000px]:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <Pending me={me} />
            <Tasks />
          </div>
          <aside aria-label="Coluna lateral" className={SIDE_COLUMN}>
            <ActiveFriends me={me} />
            <News />
          </aside>
        </div>
      </div>
      <Dialogs me={me} dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  )
}

function Dialogs({ me, dialog, onClose }: { me: Me; dialog: Dialog | null; onClose(): void }): ReactNode {
  if (dialog === 'call') return <StartCallModal meId={me.id} onClose={onClose} />
  if (dialog === 'friend') return <AddFriendModal onClose={onClose} />
  if (dialog === 'create' || dialog === 'join') return <AddServerModal initial={dialog} onClose={onClose} />
  return null
}

function Header({ me, onDialog }: { me: Me; onDialog(dialog: Dialog): void }): ReactNode {
  const loaded = useHome((s) => s.loaded)
  const friends = useSocial((s) => s.friends)
  const dms = useSocial((s) => s.dms)
  const servers = useChat((s) => s.servers)
  const pending = usePendingItems().length
  const inCall = friendsInCall(friends, servers, dms).size

  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="truncate font-display text-3xl font-bold">
          {greeting()}, {me.display_name}
        </h1>
        {loaded ? (
          <p className="mt-1 text-fg-muted">{hubSummary(inCall, pending)}</p>
        ) : (
          <span aria-hidden className="mt-2.5 block h-4 w-72 animate-pulse rounded bg-elevated" />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Action icon={Phone} label="Iniciar chamada" primary onClick={() => onDialog('call')} />
        <Action icon={UserPlus} label="Adicionar amigo" onClick={() => onDialog('friend')} />
        <Action icon={Plus} label="Criar servidor" onClick={() => onDialog('create')} />
        <Action icon={Link2} label="Entrar com convite" onClick={() => onDialog('join')} />
      </div>
    </header>
  )
}

function Action({ icon: Icon, label, primary = false, onClick }: { icon: LucideIcon; label: string; primary?: boolean; onClick(): void }): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-control px-4 py-2.5 text-sm font-semibold ${
        primary ? 'bg-accent text-on-accent hover:bg-accent-hover' : 'border border-line bg-panel text-fg hover:bg-elevated'
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  )
}

function SectionHeader({ title, hint, live = false, action }: { title: string; hint?: string; live?: boolean; action?: ReactNode }): ReactNode {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      {live && <span aria-hidden className="h-2 w-2 shrink-0 self-center rounded-full bg-danger" />}
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {hint && <span className="min-w-0 truncate text-sm text-fg-subtle">{hint}</span>}
      {action && <span className="ml-auto shrink-0">{action}</span>}
    </div>
  )
}

function LinkButton({ children, onClick }: { children: ReactNode; onClick(): void }): ReactNode {
  return (
    <button type="button" onClick={onClick} className="text-sm font-semibold text-accent-text hover:underline">
      {children}
    </button>
  )
}

function LiveNow({ me, onCall }: { me: Me; onCall(): void }): ReactNode {
  const servers = useChat((s) => s.servers)
  const chatLoaded = useChat((s) => s.loaded)
  const dms = useSocial((s) => s.dms)
  const friends = useSocial((s) => s.friends)
  const socialLoaded = useSocial((s) => s.loaded)
  const [all, setAll] = useState(false)
  const rooms = liveRooms(servers, dms, friends, me.id)
  const shown = all ? rooms : rooms.slice(0, LIVE_PREVIEW)

  // Screen thumbnails only for the cards on screen with someone streaming.
  const streaming = [
    ...new Set(shown.flatMap((r) => (r.kind === 'room' && r.states.some((v) => v.screen) ? [r.server.id] : [])))
  ].slice(0, HOME_WATCH_MAX)
  const watchKey = streaming.join(',')
  useEffect(() => (watchKey ? watchHome(watchKey.split(',')) : undefined), [watchKey])

  return (
    <section aria-label="Ao vivo agora">
      <SectionHeader
        title="Ao vivo agora"
        hint="nos seus servidores e grupos"
        live
        action={rooms.length > LIVE_PREVIEW && <LinkButton onClick={() => setAll(!all)}>{all ? 'Ver menos' : 'Ver mais'}</LinkButton>}
      />
      {!chatLoaded || !socialLoaded ? (
        <div className={CARD_GRID}>
          {[0, 1, 2].map((i) => (
            <div key={i} aria-hidden className="h-[220px] animate-pulse rounded-control bg-elevated/60" />
          ))}
        </div>
      ) : (
        <>
          <div className={CARD_GRID}>
            {shown.map((room) => (
              <LiveCard key={room.key} room={room} meId={me.id} />
            ))}
            <button
              type="button"
              onClick={onCall}
              className="flex min-h-[220px] flex-col items-center justify-center gap-1.5 rounded-control border border-dashed border-line p-5 text-center hover:border-accent/60"
            >
              <Phone size={20} className="mb-1 text-fg-muted" />
              <span className="font-semibold">Chamar alguém</span>
              <span className="text-sm text-fg-subtle">Ligue pra um amigo ou um grupo</span>
            </button>
          </div>
          {rooms.length === 0 && <p className="mt-3 text-sm text-fg-subtle">Ninguém em call agora.</p>}
        </>
      )}
    </section>
  )
}

function LiveCard({ room, meId }: { room: LiveRoom; meId: string }): ReactNode {
  const mine = useVoice((s) => s.phase !== 'idle' && s.channelId === room.key)
  // Who's speaking is only known inside our own call.
  const speaking = useVoice((s) => (mine ? s.speaking : null))
  const thumbnails = useThumbnails((s) => s.byUser)
  const activities = useActivity((s) => s.byUser)
  const now = useMinute()

  const people = new Map<string, User>(
    room.kind === 'room'
      ? room.server.members.map((m) => [m.user.id, { ...m.user, display_name: memberName(m) }])
      : room.dm.members.map((m) => [m.user.id, m.user])
  )
  const nameOf = (id: string): string => people.get(id)?.display_name ?? 'Alguém'
  const title = room.kind === 'room' ? (room.channel.name ?? '') : dmTitle(room.dm, meId)
  const place = room.kind === 'room' ? room.server.name : room.dm.type === 'group_dm' ? 'Chamada em grupo' : 'Chamada'
  const sharer = room.states.find((v) => v.screen)
  const thumb = sharer && thumbnails[sharer.user_id]?.channelId === room.key ? thumbnails[sharer.user_id] : undefined
  const count = `${room.states.length} ${room.states.length === 1 ? 'pessoa' : 'pessoas'}`
  const detail = sharer ? `${nameOf(sharer.user_id)} transmitindo` : room.since ? `${count} · ${liveFor(room.since, now)}` : count
  const playing = room.states.map((v) => activities[v.user_id]).find(Boolean)
  const ringed = (id: string): string => (speaking?.includes(id) ? 'ring-[3px] ring-accent' : '')

  const open = (): void => {
    if (room.kind === 'room') {
      if (mine) useNav.getState().expandCall(room.server.id)
      else void useVoice.getState().join(room.server.id, room.channel.id)
    } else {
      useNav.getState().openHome(room.dm.id)
      if (!mine) void useVoice.getState().join(null, room.dm.id)
    }
  }

  return (
    <article aria-label={title} className={`flex flex-col gap-3 rounded-control bg-panel p-3 ${mine ? 'border-2 border-accent' : 'border border-line'}`}>
      <div className="relative aspect-video overflow-hidden rounded-item bg-rail">
        {sharer ? (
          thumb ? (
            <img src={thumb.image} alt={`Tela de ${nameOf(sharer.user_id)}`} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-fg-subtle">
              <Radio size={18} />
              Transmissão ao vivo
            </div>
          )
        ) : (
          <div className="flex h-full flex-wrap content-center items-center justify-center gap-3 p-3">
            {room.states.slice(0, 4).map((v) => (
              <span key={v.user_id} title={nameOf(v.user_id)} className={`rounded-full ring-offset-2 ring-offset-rail ${ringed(v.user_id)}`}>
                <Avatar name={nameOf(v.user_id)} url={people.get(v.user_id)?.avatar_url} size={48} />
              </span>
            ))}
            {room.states.length > 4 && <span className="text-sm font-semibold text-fg-muted">+{room.states.length - 4}</span>}
          </div>
        )}
        {sharer && <span className="absolute left-2 top-2 rounded bg-danger px-1.5 text-[10px] font-bold leading-5 text-on-danger">AO VIVO</span>}
      </div>
      <div className="min-w-0">
        {mine && <span className="block text-[10px] font-bold uppercase tracking-wide text-accent-text">Você está aqui</span>}
        <h3 className="truncate font-semibold">{title}</h3>
        <p className="truncate text-xs text-fg-subtle">
          {place} · {detail}
        </p>
      </div>
      <div className="mt-auto flex items-center gap-2">
        {playing ? (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-fg-muted" title={activityLabel(playing)}>
            <Gamepad2 size={14} className="shrink-0" />
            <span className="truncate">{activityLabel(playing)}</span>
          </span>
        ) : (
          <span className="flex min-w-0 flex-1 items-center">
            {room.states.slice(0, 3).map((v, i) => (
              <span key={v.user_id} className={`rounded-full border-2 border-panel ${i > 0 ? '-ml-2' : ''} ${ringed(v.user_id)}`}>
                <Avatar name={nameOf(v.user_id)} url={people.get(v.user_id)?.avatar_url} size={24} />
              </span>
            ))}
            {room.states.length > 3 && (
              <span className="-ml-2 flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-panel bg-elevated px-1 text-[10px] font-semibold text-fg-muted">
                +{room.states.length - 3}
              </span>
            )}
          </span>
        )}
        <button
          type="button"
          aria-label={`${mine ? 'Abrir' : 'Entrar em'} ${title}`}
          onClick={open}
          className={`shrink-0 rounded-control px-4 py-1.5 text-sm font-semibold ${
            mine ? 'border border-line text-fg-muted hover:text-fg' : 'bg-accent text-on-accent hover:bg-accent-hover'
          }`}
        >
          {mine ? 'Abrir' : 'Entrar'}
        </button>
      </div>
    </article>
  )
}

const PENDING_PREVIEW = 8
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })

/** "12 min", "3 h", "ontem", "18/10": how long ago, short. */
export function ago(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `${minutes} min`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h`
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  return new Date(iso).toDateString() === yesterday.toDateString() ? 'ontem' : shortDate.format(new Date(iso))
}

/** A message in one line: its text, or what it carries ("Mensagem de voz · 0:42"). */
export function previewOf(message: Message): string {
  const voice = message.attachments.find((a) => a.kind === 'voice')
  if (voice) {
    const seconds = Math.round((voice.duration_ms ?? 0) / 1000)
    return `Mensagem de voz · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }
  return messagePreview(message).replace(/\s+/g, ' ')
}

function Pending({ me }: { me: Me }): ReactNode {
  const loaded = useHome((s) => s.loaded)
  const items = usePendingItems()
  const [all, setAll] = useState(false)
  const [error, setError] = useState(false)
  const shown = all ? items : items.slice(0, PENDING_PREVIEW)
  const readable = items.some((i) => i.kind === 'mention' || i.kind === 'dm')
  const now = useMinute()

  const markAll = (): void => {
    setError(false)
    useHome.getState().markAllRead().catch(() => setError(true))
  }

  return (
    <section aria-label="Pra você ver" className="rounded-panel border border-line bg-panel/40 p-4">
      <SectionHeader title="Pra você ver" action={readable && <LinkButton onClick={markAll}>Marcar tudo como lido</LinkButton>} />
      {error && <p className="mb-2 text-sm text-danger">Não foi possível marcar como lido. Tente de novo.</p>}
      {!loaded ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} aria-hidden className="h-14 animate-pulse rounded-item bg-elevated/60" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-subtle">Nada pendente por aqui.</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((item) => (
            <li key={item.key}>
              <PendingRow item={item} me={me} now={now} />
            </li>
          ))}
        </ul>
      )}
      {items.length > PENDING_PREVIEW && (
        <div className="mt-2 text-center">
          <LinkButton onClick={() => setAll(!all)}>{all ? 'Ver menos' : `Ver tudo (${items.length})`}</LinkButton>
        </div>
      )}
    </section>
  )
}

function PendingRow({ item, me, now }: { item: PendingItem; me: Me; now: number }): ReactNode {
  const [busy, setBusy] = useState(false)
  const run = (fn: () => Promise<unknown>) => (): void => {
    setBusy(true)
    fn().catch(() => setBusy(false))
  }
  const nav = useNav.getState()
  const social = useSocial.getState()

  if (item.kind === 'mention') {
    const { server, message } = item
    const channel = server.channels.find((c) => c.id === message.channel_id)
    const author = server.members.find((m) => m.user.id === message.author?.id)
    const name = author ? memberName(author) : (message.author?.display_name ?? 'Alguém')
    const open = (): void => {
      nav.openServer(server.id)
      nav.openTab(server.id, channelTab(message.channel_id))
      useChat.getState().focusMessage(message.channel_id, message.id)
    }
    return (
      <Row
        icon={<RowIcon tone="accent" icon={AtSign} />}
        title={
          <>
            <b>{name}</b> mencionou você em <b>#{channel?.name}</b>
          </>
        }
        detail={`“${previewOf(message)}” · ${server.name}`}
        time={ago(message.created_at, now)}
        onOpen={open}
        highlight
      />
    )
  }

  if (item.kind === 'dm') {
    const { dm, message, unread } = item
    const peer = dmPeer(dm, me.id)
    const count = unread === 1 ? 'uma mensagem' : `${unread} mensagens`
    const open = (): void => {
      nav.openHome(dm.id)
      useChat.getState().focusMessage(dm.id, message.id)
    }
    return (
      <Row
        icon={peer ? <Avatar name={peer.display_name} url={peer.avatar_url} size={32} /> : <GroupAvatar url={dm.icon_url} size={32} />}
        title={
          peer ? (
            <>
              <b>{peer.display_name}</b> mandou {count}
            </>
          ) : (
            <>
              {count[0].toUpperCase() + count.slice(1)} em <b>{dmTitle(dm, me.id)}</b>
            </>
          )
        }
        detail={peer ? previewOf(message) : `${message.author?.display_name ?? 'Alguém'}: ${previewOf(message)}`}
        time={ago(message.created_at, now)}
        onOpen={open}
      />
    )
  }

  if (item.kind === 'missed_call') {
    const { dm, call } = item
    const caller = dm?.members.find((m) => m.user.id === call.started_by)?.user
    return (
      <Row
        icon={<RowIcon tone="danger" icon={PhoneMissed} />}
        title={
          <>
            Chamada perdida de <b>{caller?.display_name ?? 'alguém'}</b>
          </>
        }
        detail={dm?.type === 'group_dm' ? dmTitle(dm, me.id) : undefined}
        time={ago(call.started_at, now)}
        onOpen={dm ? () => nav.openHome(dm.id) : undefined}
        actions={
          dm && (
            <RowButton
              disabled={busy}
              onClick={run(async () => {
                nav.openHome(dm.id)
                await social.startCall(dm.id)
              })}
            >
              Ligar
            </RowButton>
          )
        }
      />
    )
  }

  const { friend } = item
  return (
    <Row
      icon={<RowIcon tone="success" icon={UserPlus} />}
      title={
        <>
          <b>@{friend.user.username}</b> quer ser seu amigo
        </>
      }
      detail={friend.user.display_name}
      time={ago(friend.since, now)}
      actions={
        <>
          <RowButton primary disabled={busy} onClick={run(() => social.accept(friend.user.id))}>
            Aceitar
          </RowButton>
          <RowButton disabled={busy} onClick={run(() => social.remove(friend.user.id))}>
            Recusar
          </RowButton>
        </>
      }
    />
  )
}

const ICON_TONES = { accent: 'bg-accent/15 text-accent-text', danger: 'bg-danger/15 text-danger', success: 'bg-success/15 text-success' }

function RowIcon({ tone, icon: Icon }: { tone: keyof typeof ICON_TONES; icon: LucideIcon }): ReactNode {
  return (
    <span className={`flex h-8 w-8 items-center justify-center rounded-item ${ICON_TONES[tone]}`}>
      <Icon size={16} />
    </span>
  )
}

function RowButton({ primary = false, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }): ReactNode {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-control px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
        primary ? 'bg-accent text-on-accent hover:bg-accent-hover' : 'border border-line text-fg hover:bg-elevated'
      }`}
    />
  )
}

function Row({
  icon,
  title,
  detail,
  time,
  actions,
  highlight = false,
  onOpen
}: {
  icon: ReactNode
  title: ReactNode
  detail?: string
  time: string
  actions?: ReactNode
  /** Mentions stand out a little. */
  highlight?: boolean
  onOpen?: () => void
}): ReactNode {
  const body = (
    <>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm [&_b]:font-semibold">{title}</span>
        {detail && <span className="block truncate text-xs text-fg-subtle">{detail}</span>}
      </span>
      {!actions && <span className="shrink-0 text-xs text-fg-subtle">{time}</span>}
    </>
  )
  return (
    <div className={`flex items-center gap-3 rounded-item px-3 py-2 ${highlight ? 'bg-elevated' : onOpen ? 'hover:bg-elevated' : ''}`}>
      {onOpen ? (
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {body}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
      )}
      {actions && <span className="flex shrink-0 items-center gap-2">{actions}</span>}
    </div>
  )
}

const TASKS_PREVIEW = 6
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/**
 * A due date as the hub shows it: "23 out · atrasado" (danger), "23 out · hoje", "amanhã" or
 * "em 2 dias" (idle), or just "30 nov". `due` is YYYY-MM-DD, compared with the PC's date.
 */
export function dueLabel(due: string, today: Date = new Date()): { text: string; tone: 'danger' | 'idle' | 'muted' } {
  const [y, m, d] = due.split('-').map(Number)
  const date = `${d} ${MONTHS[m - 1]}`
  const days = Math.round((new Date(y, m - 1, d).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000)
  if (days < 0) return { text: `${date} · atrasado`, tone: 'danger' }
  if (days === 0) return { text: `${date} · hoje`, tone: 'idle' }
  if (days === 1) return { text: `${date} · amanhã`, tone: 'idle' }
  if (days === 2) return { text: `${date} · em 2 dias`, tone: 'idle' }
  return { text: date, tone: 'muted' }
}

const DUE_TONES = { danger: 'text-danger', idle: 'text-idle', muted: 'text-fg-muted' }

/** Label colors are token names (--label-<color>), the same the addon uses. */
const labelStyle = (color: string): CSSProperties => ({
  color: `var(--label-${color})`,
  background: `color-mix(in oklab, var(--label-${color}) 16%, transparent)`
})

const openTask = (task: HomeTask): void => useNav.getState().openAddonItem(task.server_id, task.channel_id, task.id)

function Tasks(): ReactNode {
  const loaded = useHome((s) => s.loaded)
  const tasks = useHome((s) => s.tasks)
  const total = useHome((s) => s.tasksTotal)
  const [all, setAll] = useState(false)

  return (
    <section aria-label="Minhas tarefas" className="rounded-panel border border-line bg-panel/40 p-4">
      <SectionHeader
        title="Minhas tarefas"
        hint="de todos os Kanbans"
        action={total > TASKS_PREVIEW && <LinkButton onClick={() => setAll(true)}>Ver todas ({total})</LinkButton>}
      />
      {!loaded ? (
        <div className={TASK_GRID}>
          {[0, 1, 2].map((i) => (
            <div key={i} aria-hidden className="h-28 animate-pulse rounded-control bg-elevated/60" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-subtle">Nenhuma tarefa com você.</p>
      ) : (
        <ul className={TASK_GRID}>
          {tasks.slice(0, TASKS_PREVIEW).map((task) => (
            <li key={task.id}>
              <TaskCard task={task} />
            </li>
          ))}
        </ul>
      )}
      {all && <AllTasksModal onClose={() => setAll(false)} />}
    </section>
  )
}

const TASK_GRID = 'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]'

function TaskCard({ task }: { task: HomeTask }): ReactNode {
  const due = task.due_date ? dueLabel(task.due_date) : null
  return (
    <button
      type="button"
      onClick={() => openTask(task)}
      className="flex h-full w-full flex-col gap-2 rounded-control border border-line bg-panel p-3 text-left hover:border-accent/60"
    >
      <span className="flex flex-wrap gap-1">
        {task.labels.map((label) => (
          <span key={label.name} style={labelStyle(label.color)} className="truncate rounded px-1.5 py-0.5 text-[11px] font-semibold">
            {label.name}
          </span>
        ))}
        <span className="truncate rounded bg-elevated px-1.5 py-0.5 text-[11px] font-semibold text-fg-muted">{task.status}</span>
      </span>
      <span className="line-clamp-2 font-semibold">{task.title}</span>
      {due && (
        <span className={`flex items-center gap-1.5 text-xs ${DUE_TONES[due.tone]}`}>
          <CalendarDays size={13} className="shrink-0" />
          {due.text}
        </span>
      )}
      <span className="mt-auto truncate text-xs text-fg-subtle">
        {task.server_name} › {task.channel_name}
      </span>
    </button>
  )
}

function AllTasksModal({ onClose }: { onClose(): void }): ReactNode {
  const [tasks, setTasks] = useState<HomeTask[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    useHome.getState().loadAllTasks().then(setTasks, () => setError(true))
  }, [])

  return (
    <Modal title="Minhas tarefas" subtitle="Tudo que está com você e ainda não foi concluído." onClose={onClose} wide>
      {error ? (
        <p className="py-6 text-center text-sm text-danger">Não foi possível carregar as tarefas.</p>
      ) : !tasks ? (
        <p className="py-6 text-center text-sm text-fg-subtle">Carregando…</p>
      ) : (
        <ul className="space-y-1">
          {tasks.map((task) => {
            const due = task.due_date ? dueLabel(task.due_date) : null
            return (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    openTask(task)
                  }}
                  className="flex w-full items-center gap-3 rounded-item px-3 py-2 text-left hover:bg-elevated"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{task.title}</span>
                    <span className="block truncate text-xs text-fg-subtle">
                      {task.status} · {task.server_name} › {task.channel_name}
                    </span>
                  </span>
                  {due && <span className={`shrink-0 text-xs ${DUE_TONES[due.tone]}`}>{due.text}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}

const FRIENDS_PREVIEW = 6
// Three rows of two beside the live rooms; the rest in "Ver todos".
const SERVERS_PREVIEW = 6

/** Where a friend is in a call that I can see: a server room or one of my conversations. */
interface FriendCall {
  label: string
  /** Whether I could join them there (CONNECT in a room, or a call in my DM or group). */
  join?: () => void
}

function callOf(userId: string, servers: Record<string, ServerDetail>, dms: Record<string, Dm>, meId: string): FriendCall | null {
  for (const server of Object.values(servers)) {
    const state = server.voice_states.find((v) => v.user_id === userId)
    const room = state && server.channels.find((c) => c.id === state.channel_id)
    if (!room) continue
    const joinable = has(channelPermissions(server, room, meId), Perm.CONNECT)
    return { label: `Em call · ${room.name}`, join: joinable ? () => void useVoice.getState().join(server.id, room.id) : undefined }
  }
  const dm = Object.values(dms).find((d) => d.call && d.voice_states.some((v) => v.user_id === userId))
  if (!dm) return null
  return {
    label: dm.type === 'group_dm' ? `Em call · ${dmTitle(dm, meId)}` : 'Em call com você',
    join: () => {
      useNav.getState().openHome(dm.id)
      void useVoice.getState().join(null, dm.id)
    }
  }
}

export interface ActiveFriend {
  friend: Friend
  status: Presence
  call: FriendCall | null
  activity: Activity | undefined
}

/** Friends online, away or busy (invisible shows as offline): in a call first, then playing, then the rest. */
export function activeFriends(
  friends: Record<string, Friend>,
  presence: Record<string, Presence>,
  activities: Record<string, Activity>,
  servers: Record<string, ServerDetail>,
  dms: Record<string, Dm>,
  meId: string
): ActiveFriend[] {
  const rank = (f: ActiveFriend): number => (f.call ? 0 : f.activity ? 1 : 2)
  return Object.values(friends)
    .filter((f) => f.kind === 'friend')
    .map((friend) => ({
      friend,
      status: presence[friend.user.id] ?? friend.status,
      call: callOf(friend.user.id, servers, dms, meId),
      activity: activities[friend.user.id]
    }))
    .filter((f) => f.status !== 'offline')
    .sort((a, b) => rank(a) - rank(b) || a.friend.user.display_name.localeCompare(b.friend.user.display_name))
}

function SideCard({ title, children, hint, action, className = '' }: { title: string; children: ReactNode; hint?: string; action?: ReactNode; className?: string }): ReactNode {
  return (
    <section aria-label={title} className={`rounded-panel border p-4 ${className || 'border-line bg-panel/40'}`}>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="min-w-0 flex-1 truncate font-display text-lg font-semibold">{title}</h2>
        {hint && <span className="shrink-0 text-xs text-fg-subtle">{hint}</span>}
        {action}
      </div>
      {children}
    </section>
  )
}

function ActiveFriends({ me }: { me: Me }): ReactNode {
  const friends = useSocial((s) => s.friends)
  const presence = useSocial((s) => s.presence)
  const dms = useSocial((s) => s.dms)
  const loaded = useSocial((s) => s.loaded)
  const servers = useChat((s) => s.servers)
  const activities = useActivity((s) => s.byUser)
  const list = activeFriends(friends, presence, activities, servers, dms, me.id)

  return (
    <SideCard
      title="Amigos ativos"
      hint={loaded ? `${list.length} online` : undefined}
      action={list.length > FRIENDS_PREVIEW && <LinkButton onClick={() => useNav.getState().openHome('friends')}>Ver todos</LinkButton>}
    >
      {!loaded ? (
        <SideSkeleton />
      ) : list.length === 0 ? (
        <p className="py-3 text-sm text-fg-subtle">Nenhum amigo online agora.</p>
      ) : (
        <ul className="space-y-1">
          {list.slice(0, FRIENDS_PREVIEW).map((f) => (
            <li key={f.friend.user.id}>
              <ActiveFriendRow item={f} />
            </li>
          ))}
        </ul>
      )}
    </SideCard>
  )
}

function ActiveFriendRow({ item }: { item: ActiveFriend }): ReactNode {
  const { friend, status, call, activity } = item
  const user = friend.user
  const line = call ? call.label : activity ? activityLabel(activity) : PRESENCE_LABEL[status]
  const social = useSocial.getState()
  const action = call?.join ? (
    <RowButton onClick={call.join}>Entrar</RowButton>
  ) : activity ? (
    <IconButton
      label={`Ligar para ${user.display_name}`}
      icon={Phone}
      onClick={async () => {
        const id = await social.openDm(user.id)
        await social.startCall(id)
      }}
    />
  ) : (
    <IconButton label={`Mensagem para ${user.display_name}`} icon={MessageCircle} onClick={() => social.openDm(user.id)} />
  )
  return (
    <div className="flex items-center gap-3 rounded-item px-1 py-1.5">
      <PresenceAvatar name={user.display_name} url={user.avatar_url} status={status} size={34} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{user.display_name}</span>
        <span className="block truncate text-xs text-fg-subtle">{line}</span>
      </span>
      {action}
    </div>
  )
}

function IconButton({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick(): Promise<unknown> | void }): ReactNode {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={busy}
      onClick={() => {
        setBusy(true)
        void Promise.resolve(onClick())
          .catch(() => {})
          .finally(() => setBusy(false))
      }}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-line text-fg-muted hover:bg-elevated hover:text-fg disabled:opacity-50"
    >
      <Icon size={16} />
    </button>
  )
}

function SideSkeleton(): ReactNode {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} aria-hidden className="h-10 animate-pulse rounded-item bg-elevated/60" />
      ))}
    </div>
  )
}

export interface ServerSummary {
  server: ServerDetail
  inCall: number
  streaming: number
  mentions: number
  lastActivity: string | null
}

/** My servers, most active first: people in a call, then the newest message. */
export function serverSummaries(
  order: string[],
  servers: Record<string, ServerDetail>,
  reads: Record<string, { mention_count: number } | undefined>,
  activity: Record<string, string | null>
): ServerSummary[] {
  return order
    .map((id) => servers[id])
    .filter(Boolean)
    .map((server) => ({
      server,
      inCall: server.voice_states.length,
      streaming: server.voice_states.filter((v) => v.screen).length,
      mentions: server.channels.reduce((n, c) => n + (reads[c.id]?.mention_count ?? 0), 0),
      lastActivity: activity[server.id] ?? null
    }))
    .sort((a, b) => b.inCall - a.inCall || (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''))
}

/**
 * A compact grid of my servers beside the live rooms, most active first: a red dot when someone
 * streams, people in a call and mentions. Opening one brings its tab back if it was closed, so
 * this is also where closed tabs come back. The last tile creates or joins a server; "Ver todos"
 * lists every one in a modal, so the grid never grows past the live rooms beside it.
 */
function YourServers({ onAdd }: { onAdd(): void }): ReactNode {
  const order = useChat((s) => s.order)
  const servers = useChat((s) => s.servers)
  const reads = useChat((s) => s.reads)
  const loaded = useChat((s) => s.loaded)
  const activity = useHome((s) => s.activity)
  const [all, setAll] = useState(false)
  const list = serverSummaries(order, servers, reads, activity)

  return (
    <section aria-label="Seus servidores">
      <SectionHeader
        title="Seus servidores"
        action={list.length > SERVERS_PREVIEW && <LinkButton onClick={() => setAll(true)}>Ver todos ({list.length})</LinkButton>}
      />
      {!loaded ? (
        <div className={SERVER_GRID}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} aria-hidden className="h-14 animate-pulse rounded-control bg-elevated/60" />
          ))}
        </div>
      ) : (
        <ul className={SERVER_GRID}>
          {list.slice(0, SERVERS_PREVIEW).map((s) => (
            <li key={s.server.id} className="min-w-0">
              <ServerTile summary={s} />
            </li>
          ))}
          <li className="min-w-0">
            <button
              type="button"
              onClick={onAdd}
              aria-label="Criar ou entrar em um servidor"
              title="Criar ou entrar em um servidor"
              className={`${TILE} h-full w-full justify-center border-dashed text-fg-muted hover:border-accent/60 hover:text-fg`}
            >
              <Plus size={18} />
              {list.length === 0 && <span className="text-sm font-medium">Criar ou entrar em um servidor</span>}
            </button>
          </li>
        </ul>
      )}
      {all && (
        <Modal title="Seus servidores" onClose={() => setAll(false)} wide>
          <ul className={SERVER_GRID}>
            {list.map((s) => (
              <li key={s.server.id} className="min-w-0">
                <ServerTile summary={s} onOpen={() => setAll(false)} />
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </section>
  )
}

const TILE = 'flex min-w-0 items-center gap-2 rounded-control border border-line bg-panel px-2.5 py-2 text-left'

function ServerTile({ summary: s, onOpen }: { summary: ServerSummary; onOpen?: () => void }): ReactNode {
  return (
    <button
      type="button"
      title={s.server.name}
      onClick={() => {
        onOpen?.()
        useNav.getState().openServer(s.server.id)
      }}
      className={`${TILE} w-full hover:border-accent/60`}
    >
      <span className="relative shrink-0">
        <ServerIcon name={s.server.name} url={s.server.icon_url} size={32} />
        {s.streaming > 0 && (
          <span
            title={`${s.streaming} transmitindo`}
            aria-label={`${s.streaming} transmitindo`}
            className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-panel bg-danger"
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{s.server.name}</span>
        {s.inCall > 0 && (
          <span className="flex items-center gap-1 text-xs text-success">
            <Volume2 size={12} className="shrink-0" />
            {s.inCall} em call
          </span>
        )}
      </span>
      <CountBadge count={s.mentions} tone="danger" />
    </button>
  )
}

// Wraps into more rows on narrow windows; never scrolls sideways.
const SERVER_GRID = 'grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(136px,1fr))]'

/** "**bold**" in changelog lines. */
function Inline({ text }: { text: string }): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>
  )
}

const NEWS_ITEMS = 3

function News(): ReactNode {
  const dismissed = useAppearance((s) => s.settings.news_dismissed)
  const [version, setVersion] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    window.aureum.app.info().then((info) => setVersion(info.version), () => {})
  }, [])
  const notes = version ? releaseNotes(CHANGELOG, version) : null
  // Dismissed until the next version.
  if (!version || !notes || dismissed === version) return null

  return (
    <SideCard
      title="Novidades do Aureum"
      className="border-accent/50 bg-accent/5"
      action={
        <button
          type="button"
          title="Dispensar"
          aria-label="Dispensar"
          onClick={() => useAppearance.getState().update({ news_dismissed: version })}
          className="shrink-0 self-center rounded-item p-1 text-fg-subtle hover:bg-elevated hover:text-fg"
        >
          <X size={16} />
        </button>
      }
    >
      <p className="mb-2 text-xs font-semibold text-accent-text">{notes.title}</p>
      <ul className="list-disc space-y-1.5 pl-5 text-sm">
        {notes.items.slice(0, NEWS_ITEMS).map((item) => (
          <li key={item} className="line-clamp-2">
            <Inline text={item} />
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <LinkButton onClick={() => setOpen(true)}>Ver tudo que mudou</LinkButton>
      </div>
      {open && (
        <Modal title="Novidades do Aureum" onClose={() => setOpen(false)} wide>
          <div className="space-y-5 pr-1">
            {CHANGELOG.map((section) => (
              <section key={section.title}>
                <h3 className="font-display font-semibold">{section.title}</h3>
                <ul className="mt-1.5 list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
                  {section.items.map((item) => (
                    <li key={item}>
                      <Inline text={item} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Modal>
      )}
    </SideCard>
  )
}
