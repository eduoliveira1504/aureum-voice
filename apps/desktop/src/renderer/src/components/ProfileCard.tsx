import { ExternalLink, Gamepad2, Link2, MessageCircle, MoreHorizontal, Music, Phone, UserPlus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { mediaUrl, type Presence, type User } from '../lib/api'
import { useUserActivity } from '../store/activity'
import { useAppearance, useReadableColor } from '../store/appearance'
import { useChat } from '../store/chat'
import { useNav } from '../store/nav'
import { useSocial } from '../store/social'
import { BadgeList, NameMarks } from './Badge'
import { openMenuAt, toast } from './ContextMenu'
import { errorText } from './modals'
import { activityLabel, FramedAvatar, StatusBubble, useElapsed } from './profileBits'
import { UserContextMenu, userContextMenu } from './UserMenu'

const joinedFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })

const Heading = ({ children }: { children: ReactNode }): ReactNode => (
  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">{children}</div>
)

/** A user's presence as the app knows it: from the open server, friends and DMs, or our own pick. */
function usePresence(userId: string, meId: string | undefined): Presence | undefined {
  const place = useNav((s) => s.place)
  const fromServer = useChat((s) => (place === 'home' ? undefined : s.servers[place]?.members.find((m) => m.user.id === userId)?.status))
  const fromSocial = useSocial((s) => s.presence[userId])
  const mine = useAppearance((s) => s.settings.status)
  if (userId === meId) return mine === 'invisible' ? 'offline' : mine
  return fromServer ?? fromSocial
}

/** The user's roles in the server on screen (strongest first, without @everyone). */
function useServerRoles(userId: string): { id: string; name: string; color: string | null }[] {
  const place = useNav((s) => s.place)
  const server = useChat((s) => (place === 'home' ? undefined : s.servers[place]))
  const member = server?.members.find((m) => m.user.id === userId)
  if (!server || !member) return []
  return server.roles.filter((r) => r.id !== server.id && member.role_ids.includes(r.id))
}

/** "AGORA": the game being played and the profile song. */
function NowBlock({ user }: { user: User }): ReactNode {
  const activity = useUserActivity(user.id)
  const elapsed = useElapsed(activity?.started_at)
  const song = user.favorite_song
  if (!activity && !song) return null
  return (
    <section>
      <Heading>Agora</Heading>
      <div className="space-y-2">
        {activity && (
          <div className="flex items-center gap-3 rounded-item bg-elevated p-2">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-item bg-accent text-on-accent">
              <Gamepad2 size={20} strokeWidth={1.8} />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold">{activityLabel(activity)}</span>
              {elapsed && <span className="text-xs text-fg-muted">Começou {elapsed}</span>}
            </span>
          </div>
        )}
        {song && (
          <div className="flex items-center gap-3 rounded-item bg-elevated p-2">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-item bg-main text-accent-text">
              <Music size={20} strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-semibold">{song.title}</span>
              <span className="block truncate text-xs text-fg-muted">{song.artist} · música do perfil</span>
            </span>
            {song.url && (
              <a href={song.url} target="_blank" rel="noreferrer" title="Abrir música" aria-label="Abrir música" className="rounded-item p-1.5 text-fg-muted hover:bg-main hover:text-fg">
                <ExternalLink size={16} strokeWidth={1.8} />
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/** Message / Call (friends only) or Add friend, plus the person's full menu. */
function Actions({ user, meId, onDone }: { user: User; meId: string; onDone(): void }): ReactNode {
  const friend = useSocial((s) => s.friends[user.id])
  const place = useNav((s) => s.place)
  const social = useSocial.getState()
  const run = (action: Promise<unknown>, done?: string): void => {
    action.then(
      () => {
        if (done) toast(done)
        onDone()
      },
      (err) => toast(errorText(err, 'Não deu certo. Tente de novo.'))
    )
  }
  const button = 'flex flex-1 items-center justify-center gap-2 rounded-control px-3 py-2 text-sm font-semibold'
  return (
    <div className="flex gap-2">
      {friend?.kind === 'friend' ? (
        <>
          <button type="button" onClick={() => run(social.openDm(user.id))} className={`${button} bg-accent text-on-accent hover:bg-accent-hover`}>
            <MessageCircle size={16} strokeWidth={1.8} /> Mensagem
          </button>
          <button type="button" onClick={() => run(social.openDm(user.id).then(social.startCall))} className={`${button} bg-elevated hover:bg-main`}>
            <Phone size={16} strokeWidth={1.8} /> Ligar
          </button>
        </>
      ) : (
        !friend && (
          <button type="button" onClick={() => run(social.sendRequest(user.username), 'Pedido enviado')} className={`${button} bg-accent text-on-accent hover:bg-accent-hover`}>
            <UserPlus size={16} strokeWidth={1.8} /> Adicionar amigo
          </button>
        )
      )}
      <button
        type="button"
        title="Mais opções"
        aria-label="Mais opções"
        onClick={(e) => openMenuAt(e.currentTarget, () => <UserContextMenu user={user} meId={meId} serverId={place === 'home' ? null : place} />)}
        className="ml-auto rounded-control bg-elevated px-3 py-2 text-fg-muted hover:bg-main hover:text-fg"
      >
        <MoreHorizontal size={18} strokeWidth={1.8} />
      </button>
    </div>
  )
}

/**
 * Profile card: banner, framed avatar with presence and status bubble, badges, names, about me,
 * what they're doing now, roles in the server on screen, links and member since. With `onClose`
 * (the popover) it also shows the actions; the settings preview doesn't.
 */
export function ProfileView({ user, onClose }: { user: User; onClose?: () => void }): ReactNode {
  const { state } = useAuth()
  const meId = state.status === 'signedIn' ? state.user.id : undefined
  const banner = mediaUrl(user.banner_url)
  const nameColor = useReadableColor(user.accent_color)
  const status = usePresence(user.id, meId)
  const roles = useServerRoles(user.id)
  const place = useNav((s) => s.place)

  return (
    <div
      // The popover's card (not the settings preview) has the person's menu.
      onContextMenu={onClose && meId ? userContextMenu(user, meId, place === 'home' ? null : place) : undefined}
      className="w-[340px] overflow-hidden rounded-panel border border-line bg-panel shadow-2xl"
    >
      {/* Without a profile color the banner falls back to the app accent. */}
      <div className="h-[120px] bg-accent" style={user.accent_color ? { background: user.accent_color } : undefined}>
        {banner && <img src={banner} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="relative px-4 pb-4">
        <div className="flex items-end gap-3">
          <div className="-mt-12 shrink-0 rounded-full bg-panel p-1.5">
            <FramedAvatar user={user} size={88} status={status} />
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <StatusBubble user={user} tail="left" className="ml-1" />
          </div>
        </div>
        <div className="absolute right-4 top-3">
          <BadgeList badges={user.badges} />
        </div>

        <div className="mt-3 space-y-3 rounded-control bg-main p-3">
          <div>
            <div className="flex min-w-0 items-center gap-1.5">
              <div
                title={user.display_name}
                className="min-w-0 truncate font-display text-xl font-semibold leading-tight"
                style={nameColor ? { color: nameColor } : undefined}
              >
                {user.display_name}
              </div>
              {/* The badges are all in the card's corner; here only the check and the BOT tag. */}
              <NameMarks user={user} size={18} badges={false} />
            </div>
            <div className="truncate text-sm text-fg-muted">
              @{user.username}
              {user.pronouns && ` · ${user.pronouns}`}
            </div>
          </div>

          {user.bio && (
            <section>
              <Heading>Sobre mim</Heading>
              <p className="select-text whitespace-pre-wrap break-words text-sm">{user.bio}</p>
            </section>
          )}

          <NowBlock user={user} />

          {roles.length > 0 && (
            <section>
              <Heading>Cargos</Heading>
              <div className="flex flex-wrap gap-1.5">
                {roles.map((r) => (
                  <span key={r.id} className="flex items-center gap-1.5 rounded-item bg-elevated px-2 py-0.5 text-xs font-medium">
                    <span className="h-2.5 w-2.5 rounded-full bg-fg-subtle" style={r.color ? { background: r.color } : undefined} />
                    {r.name}
                  </span>
                ))}
              </div>
            </section>
          )}

          {user.links.length > 0 && (
            <section>
              <Heading>Links</Heading>
              <div className="space-y-1">
                {user.links.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    title={link.url}
                    className="flex items-center gap-2 rounded-item px-1 py-0.5 text-sm hover:bg-elevated"
                  >
                    <Link2 size={14} strokeWidth={1.8} className="shrink-0 text-fg-muted" />
                    <span className="truncate text-accent-text">{link.label}</span>
                  </a>
                ))}
              </div>
            </section>
          )}

          <section>
            <Heading>Membro desde</Heading>
            <p className="text-sm">{joinedFmt.format(new Date(user.created_at))}</p>
          </section>

          {onClose && meId && user.id !== meId && <Actions user={user} meId={meId} onDone={onClose} />}
        </div>
      </div>
    </div>
  )
}

/** Popover with a user's profile, positioned next to the element that opened it. */
export function ProfilePopover({ user, anchor, onClose }: { user: User; anchor: DOMRect; onClose(): void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: anchor.right + 8, top: anchor.top })
  // Follow live profile changes (user.updated) while the card is open.
  const fresh = useFreshUser(user)

  // Keep the card on screen: open to the left if there's no room on the right, clamp vertically.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const left = anchor.right + 8 + width > window.innerWidth ? anchor.left - width - 8 : anchor.right + 8
    const top = Math.max(8, Math.min(anchor.top, window.innerHeight - height - 8))
    setPos({ left: Math.max(8, left), top })
  }, [anchor])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      // Clicks in the "more options" menu opened from the card don't close it.
      if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.('[role="menu"]')) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div ref={ref} role="dialog" aria-label={`Perfil de ${user.display_name}`} className="fixed z-50 max-h-[calc(100vh-16px)] overflow-y-auto rounded-panel" style={pos}>
      <ProfileView user={fresh} onClose={onClose} />
    </div>
  )
}

/** The latest copy of a user from the stores (servers, friends, DMs, ourselves). */
function useFreshUser(user: User): User {
  const { state } = useAuth()
  const me = state.status === 'signedIn' && state.user.id === user.id ? state.user : undefined
  const place = useNav((s) => s.place)
  const fromServer = useChat((s) => (place === 'home' ? undefined : s.servers[place]?.members.find((m) => m.user.id === user.id)?.user))
  const fromFriends = useSocial((s) => s.friends[user.id]?.user)
  return me ?? fromServer ?? fromFriends ?? user
}

/** Hook for anything that opens a profile popover on click. */
export function useProfilePopover(): {
  open(user: User, target: Element): void
  popover: ReactNode
} {
  const [state, setState] = useState<{ user: User; anchor: DOMRect } | null>(null)
  return {
    open: (user, target) => setState({ user, anchor: target.getBoundingClientRect() }),
    popover: state ? <ProfilePopover user={state.user} anchor={state.anchor} onClose={() => setState(null)} /> : null
  }
}
