import { AtSign, CalendarDays, Gamepad2, Link2, Phone, PhoneMissed, Plus, Radio, UserPlus, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'

import type { HomeTask, Me, Message, User } from '../lib/api'
import { messagePreview } from '../lib/attachments'
import { memberName } from '../lib/members'
import { useActivity } from '../store/activity'
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
import { Avatar, GroupAvatar } from './ui'

const LIVE_PREVIEW = 6
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
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-8 py-7">
        <Header me={me} onDialog={setDialog} />
        <LiveNow me={me} onCall={() => setDialog('call')} />
        <Pending me={me} />
        <Tasks />
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
