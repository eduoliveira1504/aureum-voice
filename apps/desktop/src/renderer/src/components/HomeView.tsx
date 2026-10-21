import { Ban, Check, EllipsisVertical, MessageCircle, Phone, UserMinus, UserPlus, Users, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { ApiError, type Friend, type Me, type User } from '../lib/api'
import { useActivity, useUserActivity } from '../store/activity'
import { useChat } from '../store/chat'
import { useNav } from '../store/nav'
import { dmTitle, useSocial } from '../store/social'
import { useVoice } from '../store/voice'
import { DmView } from './DmView'
import { HomeHub } from './HomeHub'
import { ConfirmModal } from './modals'
import { Avatar, CountBadge, menuClass, MenuItem, PRESENCE_LABEL, PresenceAvatar, useDismiss } from './ui'
import { ActivityLine, activityLabel, StatusBubble, useElapsed } from './profileBits'
import { userContextMenu } from './UserMenu'

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add'

/** The Home tab's content: the hub, the friends list, or the open conversation. */
export function HomeView({ me }: { me: Me }): ReactNode {
  const page = useNav((s) => s.homePage)
  const conversation = page !== 'hub' && page !== 'friends'
  const dm = useSocial((s) => (conversation ? s.dms[page] : undefined))
  const loaded = useSocial((s) => s.loaded)

  // The conversation was closed or left (maybe on another device): back to the hub.
  useEffect(() => {
    if (loaded && conversation && !dm) useNav.setState({ homePage: 'hub' })
  }, [loaded, conversation, dm])

  return (
    <div className="flex min-w-0 flex-1 py-2 pr-2">
      <section
        aria-label={dm ? dmTitle(dm, me.id) : page === 'friends' ? 'Amigos' : 'Início'}
        className="flex min-w-0 flex-1 overflow-hidden rounded-panel border border-line bg-main"
      >
        {dm ? <DmView key={dm.id} dm={dm} me={me} /> : page === 'friends' ? <FriendsPage me={me} /> : <HomeHub me={me} />}
      </section>
    </div>
  )
}

const TABS: { id: Exclude<Tab, 'add'>; label: string }[] = [
  { id: 'online', label: 'Online' },
  { id: 'all', label: 'Todos' },
  { id: 'pending', label: 'Pendentes' },
  { id: 'blocked', label: 'Bloqueados' }
]

function FriendsPage({ me }: { me: Me }): ReactNode {
  const friends = useSocial((s) => s.friends)
  const presence = useSocial((s) => s.presence)
  const [tab, setTab] = useState<Tab>('online')
  const all = Object.values(friends).sort((a, b) => a.user.display_name.localeCompare(b.user.display_name))
  const statusOf = (f: Friend): Friend['status'] => presence[f.user.id] ?? f.status
  const incoming = all.filter((f) => f.kind === 'incoming').length

  const shown =
    tab === 'online'
      ? all.filter((f) => f.kind === 'friend' && statusOf(f) !== 'offline')
      : tab === 'all'
        ? all.filter((f) => f.kind === 'friend')
        : tab === 'pending'
          ? all.filter((f) => f.kind === 'incoming' || f.kind === 'outgoing')
          : all.filter((f) => f.kind === 'blocked')

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
          <Users size={20} className="text-fg-subtle" />
          <h2 className="mr-2 font-semibold">Amigos</h2>
          <div role="tablist" className="flex min-w-0 gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-item px-2.5 py-1 text-sm font-medium ${
                  tab === t.id ? 'bg-elevated text-fg' : 'text-fg-muted hover:text-fg'
                }`}
              >
                {t.label}
                {t.id === 'pending' && <CountBadge count={incoming} tone="danger" />}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setTab('add')}
            aria-pressed={tab === 'add'}
            className={`ml-auto flex shrink-0 items-center gap-2 rounded-control px-3 py-1.5 text-sm font-semibold ${
              tab === 'add' ? 'bg-accent/15 text-accent-text' : 'bg-accent text-on-accent hover:bg-accent-hover'
            }`}
          >
            <UserPlus size={16} />
            Adicionar amigo
          </button>
        </header>

        {tab === 'add' ? (
          <AddFriend />
        ) : (
          <div className="flex-1 overflow-y-auto px-3 py-4">
            {shown.length > 0 ? (
              <>
                <h3 className="mb-2 px-2 font-sans text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                  {TABS.find((t) => t.id === tab)?.label} — {shown.length}
                </h3>
                {shown.map((f) => (
                  <FriendRow key={f.user.id} friend={f} status={statusOf(f)} meId={me.id} />
                ))}
              </>
            ) : (
              <EmptyTab tab={tab} onAdd={() => setTab('add')} />
            )}
          </div>
        )}
      </div>
      <ActiveNow me={me} />
    </>
  )
}

function EmptyTab({ tab, onAdd }: { tab: Tab; onAdd(): void }): ReactNode {
  const text = {
    online: 'Nenhum amigo online agora.',
    all: 'Você ainda não adicionou ninguém.',
    pending: 'Nenhum pedido de amizade pendente.',
    blocked: 'Você não bloqueou ninguém.',
    add: ''
  }[tab]
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-panel bg-elevated text-accent-text">
        <Users size={32} />
      </div>
      <p className="mt-4 text-fg-muted">{text}</p>
      {(tab === 'all' || tab === 'online') && (
        <button type="button" onClick={onAdd} className="mt-3 text-sm font-semibold text-accent-text hover:underline">
          Adicionar pelo @username
        </button>
      )}
    </div>
  )
}

function requestError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'Ninguém com esse username.'
    if (err.status === 400) return 'Esse é você.'
    if (err.status === 403) return 'Não dá pra enviar um pedido para essa pessoa.'
    if (err.status === 429) return 'Muitos pedidos seguidos. Tente de novo mais tarde.'
    if (err.status === 409) return err.detail === 'Unblock this user first' ? 'Desbloqueie essa pessoa primeiro.' : 'Vocês já são amigos.'
  }
  return err instanceof TypeError ? 'Não foi possível conectar ao servidor.' : 'Algo deu errado. Tente de novo.'
}

function AddFriend(): ReactNode {
  const sendRequest = useSocial((s) => s.sendRequest)
  const [value, setValue] = useState('')
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    const username = value.trim().replace(/^@/, '')
    if (!username) return
    setBusy(true)
    try {
      const friend = await sendRequest(username)
      setResult({
        ok: true,
        text:
          friend.kind === 'friend'
            ? `Você e ${friend.user.display_name} agora são amigos.`
            : `Pedido enviado para ${friend.user.display_name}.`
      })
      setValue('')
    } catch (err) {
      setResult({ ok: false, text: requestError(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-6 py-6">
      <h3 className="font-display text-lg font-semibold">Adicionar amigo</h3>
      <p className="mt-1 text-sm text-fg-muted">Digite o @username da pessoa. Ela precisa aceitar o pedido.</p>
      <form
        onSubmit={submit}
        className={`mt-4 flex items-center gap-2 rounded-control border bg-elevated p-1.5 pl-3 focus-within:ring-2 focus-within:ring-accent/25 ${
          result ? (result.ok ? 'border-success' : 'border-danger') : 'border-line focus-within:border-accent'
        }`}
      >
        <span className="text-fg-subtle">@</span>
        <input
          autoFocus
          value={value}
          maxLength={33}
          onChange={(e) => {
            setValue(e.target.value)
            setResult(null)
          }}
          placeholder="username"
          aria-label="Username"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] outline-none placeholder:text-fg-subtle"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Enviar pedido
        </button>
      </form>
      {result && <p className={`mt-2 text-sm ${result.ok ? 'text-success' : 'text-danger'}`}>{result.text}</p>}
    </div>
  )
}

function RoundButton({
  label,
  danger = false,
  onClick,
  children
}: {
  label: string
  danger?: boolean
  onClick(): void
  children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-panel text-fg-muted ${
        danger ? 'hover:text-danger' : 'hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}

function FriendRow({ friend, status, meId }: { friend: Friend; status: Friend['status']; meId: string }): ReactNode {
  const { openDm, startCall, accept, remove, unblock } = useSocial.getState()
  const [confirm, setConfirm] = useState<'remove' | 'block' | null>(null)
  const { user, kind } = friend
  const playing = !!useUserActivity(user.id)
  const subtitle =
    kind === 'friend' ? PRESENCE_LABEL[status] : kind === 'incoming' ? 'Pedido recebido' : kind === 'outgoing' ? 'Pedido enviado' : 'Bloqueado'
  const fail = (): void => {} // the next friend.* event or reload shows the real state

  return (
    <>
      <div
        role={kind === 'friend' ? 'button' : undefined}
        tabIndex={kind === 'friend' ? 0 : undefined}
        onClick={() => kind === 'friend' && void openDm(user.id).catch(fail)}
        onContextMenu={userContextMenu(user, meId)}
        onKeyDown={(e) => kind === 'friend' && e.key === 'Enter' && void openDm(user.id).catch(fail)}
        className={`group flex items-center gap-3 rounded-control border-t border-line px-2 py-2.5 first-of-type:border-t-0 ${
          kind === 'friend' ? 'cursor-pointer hover:bg-elevated/60' : ''
        }`}
      >
        <PresenceAvatar name={user.display_name} url={user.avatar_url} status={kind === 'friend' ? status : undefined} size={36} border="border-main" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">
            {user.display_name} <span className="font-normal text-fg-subtle">@{user.username}</span>
          </div>
          {kind === 'friend' && status !== 'offline' && <StatusBubble user={user} size="xs" className="my-0.5" />}
          {kind === 'friend' && playing ? (
            <ActivityLine userId={user.id} />
          ) : (
            <div className="truncate text-xs text-fg-muted">{subtitle}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {kind === 'friend' && (
            <>
              <RoundButton label="Mensagem" onClick={() => void openDm(user.id).catch(fail)}>
                <MessageCircle size={18} />
              </RoundButton>
              <RoundButton label="Ligar" onClick={() => void openDm(user.id).then(startCall).catch(fail)}>
                <Phone size={18} />
              </RoundButton>
              <FriendMenu onRemove={() => setConfirm('remove')} onBlock={() => setConfirm('block')} />
            </>
          )}
          {kind === 'incoming' && (
            <>
              <RoundButton label="Aceitar" onClick={() => void accept(user.id).catch(fail)}>
                <Check size={18} />
              </RoundButton>
              <RoundButton label="Recusar" danger onClick={() => void remove(user.id).catch(fail)}>
                <X size={18} />
              </RoundButton>
            </>
          )}
          {kind === 'outgoing' && (
            <RoundButton label="Cancelar pedido" danger onClick={() => void remove(user.id).catch(fail)}>
              <X size={18} />
            </RoundButton>
          )}
          {kind === 'blocked' && (
            <button
              type="button"
              onClick={() => void unblock(user.id).catch(fail)}
              className="rounded-control border border-line px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-elevated hover:text-fg"
            >
              Desbloquear
            </button>
          )}
        </div>
      </div>
      {confirm && (
        <ConfirmModal
          title={confirm === 'remove' ? `Remover ${user.display_name}` : `Bloquear ${user.display_name}`}
          message={
            confirm === 'remove'
              ? 'Vocês deixam de ser amigos. A conversa continua aí, mas só amigos trocam mensagens e ligações.'
              : 'A amizade acaba e essa pessoa não consegue mais te mandar pedidos, mensagens nem te ligar.'
          }
          confirmLabel={confirm === 'remove' ? 'Remover amizade' : 'Bloquear'}
          onConfirm={() => (confirm === 'remove' ? remove(user.id) : useSocial.getState().block(user.id))}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  )
}

function FriendMenu({ onRemove, onBlock }: { onRemove(): void; onBlock(): void }): ReactNode {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  const pick = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <RoundButton label="Mais opções" onClick={() => setOpen((v) => !v)}>
        <EllipsisVertical size={18} />
      </RoundButton>
      {open && (
        <div className={`${menuClass} absolute right-0 top-full mt-1 w-48`}>
          <MenuItem icon={UserMinus} label="Remover amizade" danger onClick={pick(onRemove)} />
          <MenuItem icon={Ban} label="Bloquear" danger onClick={pick(onBlock)} />
        </div>
      )}
    </div>
  )
}

interface Activity {
  key: string
  title: string
  subtitle: string
  people: User[]
  live: boolean
  here: boolean
  join(): void
}

/** Friends in calls right now, in your servers' rooms or in your groups, with a join button. */
function ActiveNow({ me }: { me: Me }): ReactNode {
  const friends = useSocial((s) => s.friends)
  const dms = useSocial((s) => s.dms)
  const servers = useChat((s) => s.servers)
  const voiceChannel = useVoice((s) => (s.phase === 'idle' ? null : s.channelId))
  const join = useVoice((s) => s.join)
  const playing = useActivity((s) => s.byUser)
  const isFriend = (id: string): boolean => friends[id]?.kind === 'friend'
  const gamers = Object.values(friends).filter((f) => f.kind === 'friend' && playing[f.user.id])

  const activities: Activity[] = []
  for (const server of Object.values(servers)) {
    for (const channel of server.channels.filter((c) => c.type === 'voice')) {
      const states = server.voice_states.filter((v) => v.channel_id === channel.id)
      if (!states.some((v) => isFriend(v.user_id))) continue
      const people = states.map((v) => server.members.find((m) => m.user.id === v.user_id)?.user).filter((u): u is User => !!u)
      activities.push({
        key: channel.id,
        title: channel.name ?? '',
        subtitle: server.name,
        people,
        live: states.some((v) => v.screen),
        here: voiceChannel === channel.id,
        join: () => void join(server.id, channel.id)
      })
    }
  }
  for (const dm of Object.values(dms)) {
    if (!dm.call || !dm.voice_states.some((v) => isFriend(v.user_id))) continue
    activities.push({
      key: dm.id,
      title: dmTitle(dm, me.id),
      subtitle: dm.type === 'dm' ? 'Chamada privada' : 'Grupo',
      people: dm.voice_states.map((v) => dm.members.find((m) => m.user.id === v.user_id)?.user).filter((u): u is User => !!u),
      live: dm.voice_states.some((v) => v.screen),
      here: voiceChannel === dm.id,
      join: () => {
        useNav.getState().openHome(dm.id)
        void join(null, dm.id)
      }
    })
  }

  return (
    <aside aria-label="Ativo agora" className="hidden w-72 shrink-0 overflow-y-auto border-l border-line p-4 xl:block">
      <h3 className="mb-3 font-sans text-xs font-semibold uppercase tracking-wide text-fg-subtle">Ativo agora</h3>
      {activities.length === 0 && gamers.length === 0 && (
        <p className="text-sm text-fg-muted">Quando seus amigos entrarem numa chamada ou abrirem um jogo, aparece aqui.</p>
      )}
      <div className="space-y-2">
        {activities.map((a) => (
          <div key={a.key} className={`rounded-control border bg-panel p-3 ${a.here ? 'border-accent' : 'border-line'}`}>
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                {a.people.slice(0, 4).map((u) => (
                  <span key={u.id} onContextMenu={userContextMenu(u, me.id)} className="rounded-full ring-2 ring-panel">
                    <Avatar name={u.display_name} url={u.avatar_url} size={26} />
                  </span>
                ))}
              </div>
              {a.people.length > 4 && <span className="text-xs text-fg-subtle">+{a.people.length - 4}</span>}
              {a.live && <span className="ml-auto rounded bg-danger px-1.5 text-[10px] font-bold leading-5 text-on-danger">AO VIVO</span>}
            </div>
            <div className="mt-2 truncate text-sm font-semibold">{a.title}</div>
            <div className="truncate text-xs text-fg-subtle">{a.subtitle}</div>
            {a.here ? (
              <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-accent-text">Você está aqui</div>
            ) : (
              <button
                type="button"
                onClick={a.join}
                className="mt-2 w-full rounded-control bg-elevated py-1.5 text-sm font-semibold hover:bg-line"
              >
                Entrar
              </button>
            )}
          </div>
        ))}
        {gamers.map((f) => (
          <PlayingCard key={f.user.id} user={f.user} meId={me.id} />
        ))}
      </div>
    </aside>
  )
}

/** A friend playing a game, in Active now. */
function PlayingCard({ user, meId }: { user: User; meId: string }): ReactNode {
  const activity = useUserActivity(user.id)
  const elapsed = useElapsed(activity?.started_at)
  if (!activity) return null
  return (
    <div onContextMenu={userContextMenu(user, meId)} className="flex items-center gap-3 rounded-control border border-line bg-panel p-3">
      <Avatar name={user.display_name} url={user.avatar_url} size={32} />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-semibold">{user.display_name}</div>
        <div className="truncate text-xs text-fg-muted">{activityLabel(activity)}</div>
        {elapsed && <div className="text-[11px] text-fg-subtle">{elapsed}</div>}
      </div>
    </div>
  )
}
