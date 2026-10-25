import { LogOut, MessageSquare, Pencil, Phone, UserPlus, Users } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { ApiError, type Channel, type Dm, type Me, type User } from '../lib/api'
import { useAppearance } from '../store/appearance'
import { useNav } from '../store/nav'
import { dmPeer, dmTitle, RING_MS, useSocial } from '../store/social'
import { useVoice } from '../store/voice'
import { ChatView } from './ChatView'
import { contextMenu } from './ContextMenu'
import { ConversationMenu } from './ConversationMenu'
import { ConfirmModal } from './modals'
import { COLUMNS, useColumnWidth } from './Resizer'
import { useProfilePopover } from './ProfileCard'
import { PickFriendsModal, RenameGroupModal } from './socialModals'
import { Avatar, GroupAvatar, PRESENCE_LABEL, PresenceAvatar } from './ui'
import { userContextMenu } from './UserMenu'
import { CallView } from './VoiceView'

type Dialog = 'add' | 'rename' | 'leave'

const OFFICIAL_READ_ONLY =
  'Esta é uma conversa oficial do Aureum. Pra falar com a gente, use o botão de bug ou o servidor do beta.'

/** A DM or group: header with call and people buttons, the call when you're in it, and the chat. */
export function DmView({ dm, me }: { dm: Dm; me: Me }): ReactNode {
  const peer = dmPeer(dm, me.id)
  const status = useSocial((s) => (peer ? (s.presence[peer.id] ?? 'offline') : undefined))
  const isFriend = useSocial((s) => !peer || s.friends[peer.id]?.kind === 'friend')
  const inCall = useVoice((s) => s.phase !== 'idle' && s.channelId === dm.id)
  const join = useVoice((s) => s.join)
  const { startCall, ringMore, addMembers, createGroup } = useSocial.getState()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(true)
  const [membersOpen, setMembersOpen] = useState(true)
  const profile = useProfilePopover()
  const chatWidth = useColumnWidth(COLUMNS.callChat, 'left')
  const title = dmTitle(dm, me.id)
  const group = dm.type === 'group_dm'
  const call = dm.call

  const channel: Channel = useMemo(
    () => ({ id: dm.id, server_id: null, name: title, type: dm.type, position: 0, addon_key: null, config: {}, overrides: [] }),
    [dm.id, dm.type, title]
  )
  const people = useMemo(() => new Map(dm.members.map((m) => [m.user.id, m.user])), [dm.members])

  async function placeCall(): Promise<void> {
    setError(null)
    try {
      await startCall(dm.id)
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? 'Só amigos podem ligar.' : 'Não foi possível começar a chamada.')
    }
  }

  /** In a call: ring them in (from a 1:1 the call moves to a new group). Otherwise: add to the
   * group, or start a new group from this DM. */
  async function addPeople(ids: string[]): Promise<void> {
    if (call && inCall) return ringMore(call.id, ids)
    if (group) return addMembers(dm.id, ids)
    const created = await createGroup([peer!.id, ...ids])
    useNav.getState().openHome(created.id)
  }

  const headerButton = 'rounded-item p-2 text-fg-muted hover:bg-elevated hover:text-fg disabled:cursor-not-allowed disabled:opacity-40'

  const official = !!dm.official
  // The API already hides it when either side turned receipts off; this hides it right away.
  const receipts = useAppearance((s) => s.settings.read_receipts !== false)
  const chat = (
    <ChatView
      key={dm.id}
      channel={channel}
      me={me}
      canModerate={false}
      canSend={!official}
      canReact={official || !peer || isFriend}
      readOnlyNote={OFFICIAL_READ_ONLY}
      peerRead={receipts ? dm.peer_read_message_id : null}
      intro={<DmIntro dm={dm} meId={me.id} isFriend={isFriend} />}
      placeholder={peer ? `Mensagem para @${peer.username}` : `Mensagem para ${title}`}
    />
  )

  return (
    // The official DM gets a thin gold frame; no other conversation can (it comes from the API's
    // official flag, never from what a message says).
    <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${official ? 'ring-1 ring-inset ring-badge-gold/40' : ''}`}>
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line pl-4 pr-2">
        {peer ? (
          // The person: click for their profile, right click for their menu.
          <button
            type="button"
            aria-label={`Perfil de ${peer.display_name}`}
            onClick={(e) => profile.open(peer, e.currentTarget)}
            onContextMenu={contextMenu(() => <ConversationMenu dm={dm} meId={me.id} />)}
            className="flex min-w-0 items-center gap-2.5 rounded-item py-1 pr-2 text-left hover:bg-elevated/60"
          >
            <PresenceAvatar name={peer.display_name} url={peer.avatar_url} status={status} size={28} border="border-main" />
            <span className="min-w-0">
              <span className="block truncate font-semibold leading-tight">{title}</span>
              <span className="block truncate text-xs text-fg-subtle">{`@${peer.username} · ${PRESENCE_LABEL[status ?? 'offline']}`}</span>
            </span>
          </button>
        ) : (
          <div onContextMenu={contextMenu(() => <ConversationMenu dm={dm} meId={me.id} />)} className="flex min-w-0 items-center gap-2.5">
            <GroupAvatar url={dm.icon_url} size={28} />
            <div className="min-w-0">
              <h2 className="truncate font-semibold leading-tight">{title}</h2>
              <p className="truncate text-xs text-fg-subtle">{dm.members.length} pessoas</p>
            </div>
          </div>
        )}
        <span className="flex-1" />
        {!official && call && !inCall && (
          <button
            type="button"
            onClick={() => void join(null, dm.id)}
            className="flex items-center gap-2 rounded-control bg-accent px-3 py-1.5 text-sm font-semibold text-on-accent hover:bg-accent-hover"
          >
            <Phone size={16} />
            Entrar na chamada
          </button>
        )}
        {!official && !call && (
          <button
            type="button"
            title={isFriend ? 'Ligar' : 'Só amigos podem ligar'}
            aria-label="Ligar"
            disabled={!isFriend}
            onClick={() => void placeCall()}
            className={headerButton}
          >
            <Phone size={20} />
          </button>
        )}
        {inCall && call && (
          <button
            type="button"
            title={chatOpen ? 'Esconder conversa' : 'Mostrar conversa'}
            aria-label={chatOpen ? 'Esconder conversa' : 'Mostrar conversa'}
            aria-pressed={chatOpen}
            onClick={() => setChatOpen(!chatOpen)}
            className={`${headerButton} ${chatOpen ? 'text-fg' : ''}`}
          >
            <MessageSquare size={20} />
          </button>
        )}
        {!official && (
          <button
            type="button"
            title={inCall ? 'Adicionar pessoas à chamada' : group ? 'Adicionar pessoas' : 'Criar grupo com mais pessoas'}
            aria-label="Adicionar pessoas"
            onClick={() => setDialog('add')}
            className={headerButton}
          >
            <UserPlus size={20} />
          </button>
        )}
        {group && (
          <>
            <button
              type="button"
              title={membersOpen ? 'Esconder membros' : 'Mostrar membros'}
              aria-label="Membros"
              aria-pressed={membersOpen}
              onClick={() => setMembersOpen(!membersOpen)}
              className={`${headerButton} ${membersOpen ? 'text-fg' : ''}`}
            >
              <Users size={20} />
            </button>
            <button type="button" title="Renomear grupo" aria-label="Renomear grupo" onClick={() => setDialog('rename')} className={headerButton}>
              <Pencil size={18} />
            </button>
            <button type="button" title="Sair do grupo" aria-label="Sair do grupo" onClick={() => setDialog('leave')} className={headerButton}>
              <LogOut size={18} />
            </button>
          </>
        )}
      </header>

      {error && (
        <div role="alert" className="border-b border-line bg-danger/10 px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {inCall && call ? (
          // In a call, the people in it always keep the main area; the chat moves to a side panel
          // with its own scroll, so it never pushes the call off screen.
          <div className="flex min-h-0 min-w-0 flex-1">
            <CallView
              title={title}
              channelId={dm.id}
              people={people}
              present={dm.voice_states}
              joinLabel="Entrar na chamada"
              onJoin={() => void join(null, dm.id)}
              meId={me.id}
              footer={<RingingLine dm={dm} meId={me.id} />}
            />
            {chatOpen && (
              <aside style={{ width: chatWidth.width }} className="relative flex min-h-0 max-w-[60%] shrink-0 border-l border-line">
                {chatWidth.handle}
                {chat}
              </aside>
            )}
          </div>
        ) : (
          chat
        )}
        {group && membersOpen && <GroupMembers dm={dm} meId={me.id} onOpen={profile.open} />}
      </div>
      {official && (
        <p className="shrink-0 border-t border-line px-4 py-2 text-center text-xs text-fg-subtle">
          O Aureum nunca pede sua senha ou código.
        </p>
      )}
      {profile.popover}

      {dialog === 'add' && (
        <PickFriendsModal
          title={inCall ? 'Chamar mais pessoas' : group ? 'Adicionar ao grupo' : 'Criar um grupo'}
          subtitle={
            inCall && !group
              ? 'Vira um grupo novo com vocês e a chamada continua lá. A conversa de vocês dois fica só entre vocês.'
              : undefined
          }
          confirmLabel={inCall ? 'Chamar' : group ? 'Adicionar' : 'Criar grupo'}
          taken={dm.members.map((m) => m.user.id)}
          onConfirm={addPeople}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'rename' && <RenameGroupModal id={dm.id} current={dm.name} onClose={() => setDialog(null)} />}
      {dialog === 'leave' && (
        <ConfirmModal
          title={`Sair de ${title}`}
          message="Você só volta se alguém do grupo te adicionar de novo."
          confirmLabel="Sair do grupo"
          onConfirm={() => useSocial.getState().closeDm(dm.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

/** The people in a group, beside its conversation. */
function GroupMembers({ dm, meId, onOpen }: { dm: Dm; meId: string; onOpen(user: User, target: Element): void }): ReactNode {
  const presence = useSocial((s) => s.presence)
  return (
    <aside aria-label="Membros do grupo" className="w-60 shrink-0 overflow-y-auto border-l border-line p-3">
      <h3 className="mb-2 px-2 font-sans text-xs font-semibold uppercase tracking-wide text-fg-subtle">Membros · {dm.members.length}</h3>
      {dm.members.map(({ user, status }) => (
        <button
          key={user.id}
          type="button"
          onClick={(e) => onOpen(user, e.currentTarget)}
          onContextMenu={userContextMenu(user, meId)}
          className="flex w-full items-center gap-2.5 rounded-item px-2 py-1.5 text-left hover:bg-elevated/60"
        >
          <PresenceAvatar name={user.display_name} url={user.avatar_url} status={presence[user.id] ?? status} size={32} border="border-main" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{user.display_name}</span>
            <span className="block truncate text-xs text-fg-subtle">@{user.username}</span>
          </span>
        </button>
      ))}
    </aside>
  )
}

function DmIntro({ dm, meId, isFriend }: { dm: Dm; meId: string; isFriend: boolean }): ReactNode {
  const peer = dmPeer(dm, meId)
  const title = dmTitle(dm, meId)
  const profile = useProfilePopover()
  return (
    <>
      {peer ? (
        <button
          type="button"
          aria-label={`Perfil de ${peer.display_name}`}
          onClick={(e) => profile.open(peer, e.currentTarget)}
          onContextMenu={userContextMenu(peer, meId)}
          className="rounded-full"
        >
          <Avatar name={peer.display_name} url={peer.avatar_url} size={72} />
        </button>
      ) : (
        <GroupAvatar url={dm.icon_url} size={72} />
      )}
      {profile.popover}
      <h3 className="mt-3 text-3xl font-bold">{title}</h3>
      <p className="mt-1 text-fg-muted">
        {dm.official
          ? 'A conversa oficial do Aureum: avisos de segurança, insígnias, bugs resolvidos e novidades chegam aqui.'
          : peer
            ? `Este é o começo da sua conversa com @${peer.username}.`
            : `Este é o começo do grupo ${title}.`}
      </p>
      {!isFriend && !dm.official && (
        <p className="mt-2 text-sm text-fg-subtle">Vocês não são amigos agora: dá pra ler a conversa, mas não mandar mensagens nem ligar.</p>
      )}
    </>
  )
}

/** Under the call: who is still being rung, and who said no. */
function RingingLine({ dm, meId }: { dm: Dm; meId: string }): ReactNode {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const call = dm.call
  if (!call) return null
  const name = (id: string): string => dm.members.find((m) => m.user.id === id)?.user.display_name ?? 'alguém'
  const waiting = call.participants.filter(
    (p) => p.user_id !== meId && p.rung_at && !p.joined_at && !p.declined_at && now - new Date(p.rung_at).getTime() < RING_MS
  )
  const declined = call.participants.filter((p) => p.user_id !== meId && p.declined_at && !p.joined_at)
  if (!waiting.length && !declined.length) return null
  return (
    <p className="shrink-0 px-4 pb-2 text-center text-sm text-fg-muted">
      {waiting.length > 0 && <span className="animate-pulse">Chamando {waiting.map((p) => name(p.user_id)).join(', ')}…</span>}
      {waiting.length > 0 && declined.length > 0 && ' · '}
      {declined.length > 0 && `${declined.map((p) => name(p.user_id)).join(', ')} recusou`}
    </p>
  )
}
