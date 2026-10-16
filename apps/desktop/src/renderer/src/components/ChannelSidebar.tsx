import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { api, type Channel, type Me, type ServerDetail } from '../lib/api'
import { useChat } from '../store/chat'
import { ConfirmModal, CreateChannelModal, InviteModal } from './modals'
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
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const myRole = server.members.find((m) => m.user.id === me.id)?.role
  const canManage = myRole === 'owner' || myRole === 'admin'

  const sections = [
    { type: 'text' as const, title: 'Canais de texto', icon: '#' },
    { type: 'voice' as const, title: 'Canais de voz', icon: '🔊' }
  ]

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-surface-1">
      <ServerMenu
        server={server}
        isOwner={myRole === 'owner'}
        canManage={canManage}
        onPick={(d) => setDialog(d)}
      />

      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        {sections.map(({ type, title, icon }) => (
          <section key={type}>
            <div className="group mb-1 flex items-center px-1">
              <h3 className="flex-1 text-xs font-bold uppercase tracking-wide text-fg-subtle">{title}</h3>
              {canManage && (
                <button
                  type="button"
                  title="Criar canal"
                  onClick={() => setDialog({ kind: 'channel', type })}
                  className="text-lg leading-none text-fg-subtle hover:text-fg"
                >
                  +
                </button>
              )}
            </div>
            {server.channels
              .filter((c) => c.type === type)
              .map((channel) => {
                const active = channel.id === selectedChannelId
                return (
                  <div
                    key={channel.id}
                    className={`group flex items-center rounded ${active ? 'bg-surface-3 text-fg' : 'text-fg-subtle hover:bg-surface-3/50 hover:text-fg-muted'}`}
                  >
                    <button
                      type="button"
                      onClick={() => selectChannel(server.id, channel.id)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left"
                    >
                      <span className="w-5 shrink-0 text-center text-base opacity-70">{icon}</span>
                      <span className="truncate font-medium">{channel.name}</span>
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        title="Excluir canal"
                        onClick={() => setDialog({ kind: 'deleteChannel', channel })}
                        className="hidden px-2 text-xs text-fg-subtle hover:text-danger group-hover:block"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )
              })}
          </section>
        ))}
      </div>

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
      className={`block w-full rounded px-2 py-1.5 text-left text-sm ${danger ? 'text-danger hover:bg-danger hover:text-white' : 'text-fg-muted hover:bg-accent hover:text-accent-fg'}`}
    >
      {label}
    </button>
  )

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-full items-center border-b border-surface-0 px-4 text-left font-semibold shadow-sm hover:bg-surface-3/40"
      >
        <span className="flex-1 truncate">{server.name}</span>
        <span className="text-xs text-fg-muted">{open ? '✕' : '▾'}</span>
      </button>
      {open && (
        <div className="absolute left-2 right-2 top-[52px] z-20 rounded bg-surface-0 p-1.5 shadow-xl">
          {item('Convidar pessoas', { kind: 'invite' })}
          {canManage && item('Criar canal', { kind: 'channel', type: 'text' })}
          <div className="my-1 h-px bg-surface-3" />
          {isOwner ? item('Excluir servidor', { kind: 'delete' }, true) : item('Sair do servidor', { kind: 'leave' }, true)}
        </div>
      )}
    </div>
  )
}

export function UserPanel({ user }: { user: Me }): ReactNode {
  const { logout } = useAuth()
  const status = useChat((s) => s.status)
  return (
    <div className="flex h-[52px] items-center gap-2 bg-surface-0/60 px-2">
      <div className="relative">
        <Avatar name={user.display_name} url={user.avatar_url} />
        <span
          title={status === 'online' ? 'Conectado' : 'Reconectando…'}
          className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-[3px] border-surface-1 ${status === 'online' ? 'bg-green-500' : 'bg-fg-subtle'}`}
        />
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-semibold">{user.display_name}</div>
        <div className="truncate text-xs text-fg-subtle">@{user.username}</div>
      </div>
      <button type="button" title="Sair da conta" onClick={logout} className="rounded px-2 py-1 text-xs text-fg-muted hover:bg-surface-3 hover:text-fg">
        Sair
      </button>
    </div>
  )
}
