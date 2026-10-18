import { ChevronDown, Hash, Radio, UserPlus, Volume2 } from 'lucide-react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

import { ADDONS } from '../addons/registry'
import { api, mediaUrl, type Channel, type Me, type Member, type Message, type ServerDetail, type VoiceState } from '../lib/api'
import { memberName } from '../lib/members'
import { basePermissions, has, Perm } from '../lib/permissions'
import { useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { addonTab, channelTab, useNav } from '../store/nav'
import { useThumbnails, watchOverview, type Thumbnail } from '../store/thumbnails'
import { useVoice } from '../store/voice'
import { groupMembers, MemberRow } from './MemberList'
import { InviteModal } from './modals'
import { useProfilePopover } from './ProfileCard'
import { COLUMNS, useColumnWidth } from './Resizer'
import { Avatar, CountBadge, ServerIcon } from './ui'

const FEED_SIZE = 30
const PER_CHANNEL = 3
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })

function shortTime(iso: string): string {
  const date = new Date(iso)
  return date.toDateString() === new Date().toDateString() ? timeFmt.format(date) : dayFmt.format(date)
}

/** A server's home: who's in which room right now, its addons, unread news and who's online. */
export function ServerOverview({ server, me }: { server: ServerDetail; me: Me }): ReactNode {
  // While this is on screen, the API sends the server's screen-share thumbnails.
  useEffect(() => watchOverview(server.id), [server.id])
  const members = new Map(server.members.map((m) => [m.user.id, m]))
  const side = useColumnWidth(COLUMNS.overviewSide, 'left')

  return (
    <div className="@container flex min-h-0 flex-1 overflow-y-auto">
      <div className="flex w-full flex-col @3xl:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-7 p-5">
          <Banner server={server} me={me} />
          <Rooms server={server} members={members} />
          <Addons serverId={server.id} />
        </div>
        {/* Beside the rooms on wide panels (resizable), below them on narrow ones. */}
        <aside
          style={{ '--side-w': `${side.width}px` } as CSSProperties}
          className="relative flex shrink-0 flex-col gap-7 border-line p-5 @3xl:w-(--side-w) @3xl:border-l"
        >
          <div className="hidden @3xl:block">{side.handle}</div>
          <News server={server} />
          <Members server={server} meId={me.id} />
        </aside>
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }): ReactNode {
  return <h3 className="mb-3 font-sans text-xs font-semibold uppercase tracking-wide text-fg-subtle">{children}</h3>
}

function Banner({ server, me }: { server: ServerDetail; me: Me }): ReactNode {
  const [inviting, setInviting] = useState(false)
  const canInvite = has(basePermissions(server, me.id), Perm.CREATE_INVITE)
  const banner = mediaUrl(server.banner_url)
  const online = server.members.filter((m) => m.online).length
  const streaming = server.voice_states.filter((v) => v.screen).length
  const stats = [
    `${online} online`,
    `${streaming} transmitindo`,
    `${server.members.length} ${server.members.length === 1 ? 'membro' : 'membros'}`
  ]

  return (
    // Without an uploaded banner, an accent gradient.
    <div
      style={banner ? { backgroundImage: `url("${banner}")` } : undefined}
      className={`relative flex items-end gap-4 overflow-hidden rounded-panel bg-cover bg-center p-5 pt-20 ${
        banner ? '' : 'bg-[linear-gradient(135deg,color-mix(in_oklab,var(--accent)_38%,var(--bg-elevated)),var(--bg-elevated)_70%)]'
      }`}
    >
      {/* Keeps the name readable over any image. */}
      {banner && <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-scrim/80 via-scrim/30 to-transparent" />}
      <span className="relative rounded-control border-4 border-main">
        <ServerIcon name={server.name} url={server.icon_url} size={64} />
      </span>
      <div className={`relative min-w-0 flex-1 ${banner ? 'text-on-scrim' : ''}`}>
        <h2 className="truncate text-2xl font-bold">{server.name}</h2>
        <p className={`mt-0.5 text-sm ${banner ? 'text-on-scrim/80' : 'text-fg-muted'}`}>{stats.join(' · ')}</p>
      </div>
      {/* Invites also create accounts, so @everyone can't hand them out by default. */}
      {canInvite && (
        <button
          type="button"
          onClick={() => setInviting(true)}
          className="relative flex shrink-0 items-center gap-2 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover"
        >
          <UserPlus size={16} />
          Convidar
        </button>
      )}
      {inviting && <InviteModal server={server} onClose={() => setInviting(false)} />}
    </div>
  )
}

function Rooms({ server, members }: { server: ServerDetail; members: Map<string, Member> }): ReactNode {
  const thumbnails = useThumbnails((s) => s.byUser)
  const rooms = server.channels.filter((c) => c.type === 'voice')
  if (rooms.length === 0) return null
  return (
    <section>
      <SectionTitle>Salas agora</SectionTitle>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
        {rooms.map((room) => (
          <RoomCard
            key={room.id}
            server={server}
            room={room}
            states={server.voice_states.filter((v) => v.channel_id === room.id)}
            members={members}
            thumbnails={thumbnails}
          />
        ))}
      </div>
    </section>
  )
}

function RoomCard({
  server,
  room,
  states,
  members,
  thumbnails
}: {
  server: ServerDetail
  room: Channel
  states: VoiceState[]
  members: Map<string, Member>
  thumbnails: Record<string, Thumbnail>
}): ReactNode {
  const mine = useVoice((s) => s.phase !== 'idle' && s.channelId === room.id)
  // Who's speaking is only known inside our own call.
  const speaking = useVoice((s) => (mine ? s.speaking : null))
  const join = useVoice((s) => s.join)
  const expandCall = useNav((s) => s.expandCall)
  const nameOf = (id: string): string => {
    const member = members.get(id)
    return member ? memberName(member) : 'Alguém'
  }

  if (states.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-control border-2 border-dashed border-line p-5 text-center">
        <Volume2 size={22} className="text-fg-subtle" />
        <span className="font-medium">{room.name}</span>
        <button
          type="button"
          onClick={() => void join(server.id, room.id)}
          className="rounded-control border border-line px-3 py-1.5 text-sm font-medium text-fg-muted hover:border-accent hover:text-accent-text"
        >
          Abrir a sala
        </button>
      </div>
    )
  }

  const sharer = states.find((v) => v.screen)
  const thumb = sharer && thumbnails[sharer.user_id]?.channelId === room.id ? thumbnails[sharer.user_id] : undefined

  return (
    <div className={`overflow-hidden rounded-control bg-panel ${mine ? 'border-2 border-accent' : 'border border-line'}`}>
      {sharer ? (
        <div className="relative aspect-video bg-scrim">
          {thumb ? (
            <img src={thumb.image} alt={`Tela de ${nameOf(sharer.user_id)}`} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-on-scrim/70">
              <Radio size={18} />
              Transmissão ao vivo
            </div>
          )}
          <div className="absolute left-2 top-2 flex items-center gap-1.5">
            <span className="rounded bg-danger px-1.5 text-[10px] font-bold leading-5 text-on-danger">AO VIVO</span>
            <span className="truncate rounded-item bg-scrim/60 px-2 py-0.5 text-xs text-on-scrim">Tela de {nameOf(sharer.user_id)}</span>
          </div>
        </div>
      ) : (
        <div className="flex aspect-video flex-wrap content-center items-center justify-center gap-3 p-4">
          {states.slice(0, 6).map((v) => {
            const user = members.get(v.user_id)?.user
            return (
              <span
                key={v.user_id}
                title={nameOf(v.user_id)}
                className={`rounded-full ring-offset-2 ring-offset-panel ${speaking?.includes(v.user_id) ? 'ring-[3px] ring-accent' : ''}`}
              >
                <Avatar name={nameOf(v.user_id)} url={user?.avatar_url} size={52} />
              </span>
            )
          })}
          {states.length > 6 && <span className="text-sm font-semibold text-fg-muted">+{states.length - 6}</span>}
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          {mine && <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-accent-text">Você está aqui</span>}
          <span className="block truncate font-medium">{room.name}</span>
          <span className="block text-xs text-fg-subtle">
            {states.length} {states.length === 1 ? 'pessoa' : 'pessoas'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => (mine ? expandCall(server.id) : void join(server.id, room.id))}
          className={`shrink-0 rounded-control px-3 py-1.5 text-sm font-semibold ${
            mine ? 'border border-line text-fg-muted hover:text-fg' : 'bg-accent text-on-accent hover:bg-accent-hover'
          }`}
        >
          {mine ? 'Abrir' : 'Entrar'}
        </button>
      </div>
    </div>
  )
}

function Addons({ serverId }: { serverId: string }): ReactNode {
  const openTab = useNav((s) => s.openTab)
  return (
    <section>
      <SectionTitle>Addons do servidor</SectionTitle>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
        {ADDONS.map(({ key, name, icon: Icon, description }) => (
          <button
            key={key}
            type="button"
            onClick={() => openTab(serverId, addonTab(key))}
            className="flex flex-col gap-2 rounded-control border border-dashed border-line p-4 text-left hover:border-accent/60"
          >
            <span className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-item bg-elevated text-accent-text">
                <Icon size={18} />
              </span>
              <span className="flex-1 font-semibold">{name}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">em breve</span>
            </span>
            <span className="line-clamp-2 text-sm text-fg-muted">{description}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

/** Unread messages grouped by channel (newest channel first), each with a shortcut to open it. */
function News({ server }: { server: ServerDetail }): ReactNode {
  const openTab = useNav((s) => s.openTab)
  const reads = useChat((s) => s.reads)
  const mutedPlaces = useAppearance((s) => s.settings.muted_places)
  // Changes whenever a message arrives or a channel is read: the cue to refetch.
  const unread = server.channels.reduce((n, c) => n + (reads[c.id]?.unread_count ?? 0), 0)
  const [items, setItems] = useState<Message[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      api<Message[]>(`/servers/${server.id}/unread?limit=${FEED_SIZE}`).then(
        (list) => !cancelled && setItems(list),
        () => !cancelled && setItems((cur) => cur ?? [])
      )
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [server.id, unread])

  // The feed is newest first; group it keeping that order, a few messages per channel.
  const groups = new Map<string, Message[]>()
  for (const m of items ?? []) {
    // Silenced channels (or the whole server) stay out, unless they mention the user.
    const silenced = mutedPlaces.includes(server.id) || mutedPlaces.includes(m.channel_id)
    if (silenced && !reads[m.channel_id]?.mention_count) continue
    const list = groups.get(m.channel_id) ?? []
    if (list.length < PER_CHANNEL) groups.set(m.channel_id, [...list, m])
  }

  return (
    <section>
      <SectionTitle>Novidades</SectionTitle>
      {items === null ? (
        <p className="text-sm text-fg-subtle">Carregando…</p>
      ) : groups.size === 0 ? (
        <p className="text-sm text-fg-subtle">Tudo em dia. Nenhuma mensagem nova.</p>
      ) : (
        <ul className="space-y-3">
          {[...groups].map(([channelId, messages]) => {
            const channel = server.channels.find((c) => c.id === channelId)
            const read = reads[channelId]
            const open = (): void => openTab(server.id, channelTab(channelId))
            return (
              <li key={channelId} className="overflow-hidden rounded-control border border-line bg-panel/60">
                <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5">
                  <Hash size={14} className="shrink-0 text-fg-subtle" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{channel?.name}</span>
                  <CountBadge count={read?.unread_count ?? messages.length} tone={read?.mention_count ? 'danger' : 'accent'} />
                  <button
                    type="button"
                    onClick={open}
                    className="shrink-0 rounded-item px-2 py-0.5 text-xs font-semibold text-accent-text hover:bg-elevated"
                  >
                    Abrir
                  </button>
                </div>
                {/* Oldest of the group first, like in the chat. */}
                {[...messages].reverse().map((m) => {
                  const name = m.author ? nameIn(server, m.author.id, m.author.display_name) : 'Usuário removido'
                  return (
                    <button key={m.id} type="button" onClick={open} className="flex w-full gap-2.5 p-2 text-left hover:bg-elevated/60">
                      <Avatar name={name} url={m.author?.avatar_url} size={24} shape="rounded" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5 text-xs">
                          <span className="truncate font-semibold text-fg">{name}</span>
                          <span className="ml-auto shrink-0 text-fg-subtle">{shortTime(m.created_at)}</span>
                        </span>
                        <span className="line-clamp-2 break-words text-sm text-fg-muted">{m.content}</span>
                      </span>
                    </button>
                  )
                })}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function nameIn(server: ServerDetail, userId: string, fallback: string): string {
  const member = server.members.find((m) => m.user.id === userId)
  return member ? memberName(member) : fallback
}

/** Everyone in one block: online first, grouped by role, then offline (collapsed). */
function Members({ server, meId }: { server: ServerDetail; meId: string }): ReactNode {
  const [showOffline, setShowOffline] = useState(false)
  const profile = useProfilePopover()
  const roles = new Map(server.roles.map((r) => [r.id, r]))
  const roomOf = new Map(server.voice_states.map((v) => [v.user_id, server.channels.find((c) => c.id === v.channel_id)?.name]))
  const groups = groupMembers(server)
  const offline = groups.find((g) => g.key === 'offline')
  const online = groups.filter((g) => g.key !== 'offline')
  const onlineCount = online.reduce((n, g) => n + g.members.length, 0)
  const row = (m: Member): ReactNode => (
    <MemberRow key={m.user.id} member={m} server={server} roles={roles} meId={meId} room={roomOf.get(m.user.id)} onOpen={profile.open} />
  )

  return (
    <section>
      <SectionTitle>
        Membros — {onlineCount} de {server.members.length} online
      </SectionTitle>
      {online.map((g) => (
        <div key={g.key} className="mb-3">
          <h4 className="mb-0.5 truncate px-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
            {g.title} — {g.members.length}
          </h4>
          {g.members.map(row)}
        </div>
      ))}
      {offline && (
        <>
          <button
            type="button"
            aria-expanded={showOffline}
            onClick={() => setShowOffline((v) => !v)}
            className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle hover:text-fg-muted"
          >
            <ChevronDown size={12} className={`transition-transform ${showOffline ? '' : '-rotate-90'}`} />
            Offline — {offline.members.length}
          </button>
          {showOffline && offline.members.map(row)}
        </>
      )}
      {profile.popover}
    </section>
  )
}
