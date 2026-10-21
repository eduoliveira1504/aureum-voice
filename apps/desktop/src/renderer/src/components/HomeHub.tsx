import { Gamepad2, Link2, Phone, Plus, Radio, UserPlus, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import type { Me, User } from '../lib/api'
import { memberName } from '../lib/members'
import { useActivity } from '../store/activity'
import { useChat } from '../store/chat'
import { friendsInCall, liveRooms, useHome, usePendingItems, type LiveRoom } from '../store/home'
import { useNav } from '../store/nav'
import { dmTitle, useSocial } from '../store/social'
import { HOME_WATCH_MAX, useThumbnails, watchHome } from '../store/thumbnails'
import { useVoice } from '../store/voice'
import { AddServerModal } from './modals'
import { activityLabel } from './profileBits'
import { AddFriendModal, StartCallModal } from './socialModals'
import { Avatar } from './ui'

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
