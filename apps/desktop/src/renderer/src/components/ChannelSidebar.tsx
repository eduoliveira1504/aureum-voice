import {
  ChevronDown,
  Hash,
  HeadphoneOff,
  Headphones,
  Mic,
  MicOff,
  PhoneOff,
  Plus,
  Settings,
  Trash2,
  Video,
  Volume2,
  X
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { api, type Channel, type Me, type ServerDetail } from '../lib/api'
import { useChat } from '../store/chat'
import { useVoice } from '../store/voice'
import { ConfirmModal, CreateChannelModal, InviteModal } from './modals'
import { SettingsModal } from './SettingsModal'
import { Avatar } from './ui'

type Dialog =
  | { kind: 'invite' }
  | { kind: 'channel'; type: 'text' | 'voice' }
  | { kind: 'leave' }
  | { kind: 'delete' }
  | { kind: 'deleteChannel'; channel: Channel }

export function ChannelSidebar({
  server,
  selectedChannelId,
  me
}: {
  server: ServerDetail
  selectedChannelId: string | undefined
  me: Me
}): ReactNode {
  const selectChannel = useChat((s) => s.selectChannel)
  const joinVoice = useVoice((s) => s.join)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const myRole = server.members.find((m) => m.user.id === me.id)?.role
  const canManage = myRole === 'owner' || myRole === 'admin'

  const sections = [
    { type: 'text' as const, title: 'Canais de texto', Icon: Hash },
    { type: 'voice' as const, title: 'Canais de voz', Icon: Volume2 }
  ]

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-panel">
      <ServerMenu
        server={server}
        isOwner={myRole === 'owner'}
        canManage={canManage}
        onPick={(d) => setDialog(d)}
      />

      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        {sections.map(({ type, title, Icon }) => (
          <section key={type}>
            <div className="group mb-1 flex items-center px-1">
              <h3 className="flex-1 font-sans text-xs font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3>
              {canManage && (
                <button
                  type="button"
                  title="Criar canal"
                  onClick={() => setDialog({ kind: 'channel', type })}
                  aria-label="Criar canal"
                  className="text-fg-subtle hover:text-fg"
                >
                  <Plus size={16} />
                </button>
              )}
            </div>
            {server.channels
              .filter((c) => c.type === type)
              .map((channel) => {
                const active = channel.id === selectedChannelId
                return (
                  <div key={channel.id}>
                    <div
                      className={`group flex items-center rounded-item ${active ? 'bg-elevated text-fg' : 'text-fg-muted hover:bg-elevated/60 hover:text-fg'}`}
                    >
                    <button
                      type="button"
                      onClick={() => {
                        selectChannel(server.id, channel.id)
                        // Clicking a voice channel joins it, like Discord.
                        if (channel.type === 'voice') void joinVoice(server.id, channel.id)
                      }}
                      className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left"
                    >
                      <Icon size={18} className="shrink-0 opacity-70" />
                      <span className="truncate font-medium">{channel.name}</span>
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        title="Excluir canal"
                        onClick={() => setDialog({ kind: 'deleteChannel', channel })}
                        aria-label="Excluir canal"
                        className="hidden px-2 text-fg-subtle hover:text-danger group-hover:block"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    </div>
                    {channel.type === 'voice' && <VoiceMembers server={server} channelId={channel.id} />}
                  </div>
                )
              })}
          </section>
        ))}
      </div>

      <VoiceStatusPanel server={server} />
      <UserPanel user={me} />

      {dialog?.kind === 'invite' && <InviteModal server={server} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'channel' && (
        <CreateChannelModal serverId={server.id} initialType={dialog.type} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'leave' && (
        <ConfirmModal
          title={`Sair de ${server.name}`}
          message="Você só volta com um novo convite."
          confirmLabel="Sair do servidor"
          onConfirm={() => api(`/servers/${server.id}/members/me`, { method: 'DELETE' })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmModal
          title={`Excluir ${server.name}`}
          message="Todos os canais e mensagens serão apagados para sempre."
          confirmLabel="Excluir servidor"
          onConfirm={() => api(`/servers/${server.id}`, { method: 'DELETE' })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'deleteChannel' && (
        <ConfirmModal
          title={`Excluir ${dialog.channel.type === 'text' ? '#' : ''}${dialog.channel.name}`}
          message={dialog.channel.type === 'text' ? 'Todas as mensagens do canal serão apagadas.' : 'O canal de voz será removido.'}
          confirmLabel="Excluir canal"
          onConfirm={() => api(`/channels/${dialog.channel.id}`, { method: 'DELETE' })}
          onClose={() => setDialog(null)}
        />
      )}
    </aside>
  )
}

function ServerMenu({
  server,
  isOwner,
  canManage,
  onPick
}: {
  server: ServerDetail
  isOwner: boolean
  canManage: boolean
  onPick(d: Dialog): void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const item = (label: string, d: Dialog, danger = false): ReactNode => (
    <button
      type="button"
      onClick={() => {
        setOpen(false)
        onPick(d)
      }}
      className={`block w-full rounded-item px-2 py-1.5 text-left text-sm ${danger ? 'text-danger hover:bg-danger hover:text-on-danger' : 'text-fg-muted hover:bg-accent hover:text-on-accent'}`}
    >
      {label}
    </button>
  )

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-full items-center border-b border-line px-4 text-left font-display font-semibold hover:bg-elevated/40"
      >
        <span className="flex-1 truncate">{server.name}</span>
        {open ? <X size={16} className="text-fg-muted" /> : <ChevronDown size={16} className="text-fg-muted" />}
      </button>
      {open && (
        <div className="absolute left-2 right-2 top-[52px] z-20 rounded-control border border-line bg-main p-1.5 shadow-xl">
          {/* Invites also create accounts, so only owners/admins can hand them out. */}
          {canManage && item('Convidar pessoas', { kind: 'invite' })}
          {canManage && item('Criar canal', { kind: 'channel', type: 'text' })}
          {canManage && <div className="my-1 h-px bg-line" />}
          {isOwner ? item('Excluir servidor', { kind: 'delete' }, true) : item('Sair do servidor', { kind: 'leave' }, true)}
        </div>
      )}
    </div>
  )
}

/** Who is in a voice channel, shown under it in the channel list. */
function VoiceMembers({ server, channelId }: { server: ServerDetail; channelId: string }): ReactNode {
  const speaking = useVoice((s) => s.speaking)
  const states = server.voice_states.filter((v) => v.channel_id === channelId)
  if (states.length === 0) return null
  const members = new Map(server.members.map((m) => [m.user.id, m]))

  return (
    <ul className="mb-1 ml-7 space-y-0.5">
      {states.map((v) => {
        const user = members.get(v.user_id)?.user
        const name = user?.display_name ?? '…'
        return (
          <li key={v.user_id} className="flex items-center gap-2 rounded-item px-1.5 py-1 text-sm text-fg-muted hover:bg-elevated/40">
            <span className={`rounded-full ${speaking.includes(v.user_id) ? 'ring-2 ring-accent' : ''}`}>
              <Avatar name={name} url={user?.avatar_url} size={22} />
            </span>
            <span className="min-w-0 flex-1 truncate">{name}</span>
            {v.screen && (
              <span className="shrink-0 rounded bg-danger px-1 text-[10px] font-bold leading-4 text-on-danger">AO VIVO</span>
            )}
            {v.camera && <Video size={14} className="shrink-0 text-fg-subtle" />}
            {v.deafened ? (
              <HeadphoneOff size={14} className="shrink-0 text-danger" />
            ) : (
              v.muted && <MicOff size={14} className="shrink-0 text-danger" />
            )}
          </li>
        )
      })}
    </ul>
  )
}

const PHASE_LABEL = { connecting: 'Conectando…', reconnecting: 'Reconectando…', connected: 'Voz conectada' }

/** "Voice connected" bar above the user panel while in a call. */
function VoiceStatusPanel({ server }: { server: ServerDetail }): ReactNode {
  const { phase, serverId, channelId, error, leave, clearError } = useVoice()
  const servers = useChat((s) => s.servers)

  if (phase === 'idle') {
    if (!error) return null
    return (
      <div className="flex items-start gap-2 border-b border-line bg-danger/15 px-3 py-2 text-xs">
        <span className="flex-1">{error}</span>
        <button type="button" onClick={clearError} className="text-fg-muted hover:text-fg" aria-label="Fechar">
          <X size={14} />
        </button>
      </div>
    )
  }

  const voiceServer = (serverId && servers[serverId]) || server
  const channel = voiceServer.channels.find((c) => c.id === channelId)

  return (
    <div className="border-b border-line bg-rail/40 px-2 py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 leading-tight">
          <div className={`text-sm font-semibold ${phase === 'connected' ? 'text-success' : 'text-accent-text'}`}>
            {PHASE_LABEL[phase]}
          </div>
          <div className="truncate text-xs text-fg-subtle">
            {channel?.name} / {voiceServer.name}
          </div>
        </div>
        <button
          type="button"
          title="Desconectar"
          aria-label="Desconectar"
          onClick={leave}
          className="rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg"
        >
          <PhoneOff size={18} />
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}

export function UserPanel({ user }: { user: Me }): ReactNode {
  const status = useChat((s) => s.status)
  const { muted, deafened, toggleMute, toggleDeafen } = useVoice()
  const [settings, setSettings] = useState(false)
  const micOff = muted || deafened
  const iconButton = 'rounded-item p-1.5 hover:bg-elevated'

  return (
    <div className="flex h-[52px] items-center gap-1 bg-rail/60 px-2">
      <div className="relative">
        <Avatar name={user.display_name} url={user.avatar_url} />
        <span
          title={status === 'online' ? 'Conectado' : 'Reconectando…'}
          className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-[3px] border-panel ${status === 'online' ? 'bg-success' : 'bg-fg-subtle'}`}
        />
      </div>
      <div className="ml-1 min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-semibold">{user.display_name}</div>
        <div className="truncate text-xs text-fg-subtle">@{user.username}</div>
      </div>
      <button
        type="button"
        title={micOff ? 'Ativar microfone' : 'Silenciar'}
        aria-label={micOff ? 'Ativar microfone' : 'Silenciar'}
        onClick={toggleMute}
        className={`${iconButton} ${micOff ? 'text-danger' : 'text-fg-muted'}`}
      >
        {micOff ? <MicOff size={18} /> : <Mic size={18} />}
      </button>
      <button
        type="button"
        title={deafened ? 'Ativar áudio' : 'Desativar áudio'}
        aria-label={deafened ? 'Ativar áudio' : 'Desativar áudio'}
        onClick={toggleDeafen}
        className={`${iconButton} ${deafened ? 'text-danger' : 'text-fg-muted'}`}
      >
        {deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
      </button>
      <button
        type="button"
        title="Configurações"
        aria-label="Configurações"
        onClick={() => setSettings(true)}
        className={`${iconButton} text-fg-muted`}
      >
        <Settings size={18} />
      </button>
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
    </div>
  )
}
