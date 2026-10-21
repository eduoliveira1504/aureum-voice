import { Link2, Phone, Plus, UserPlus, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import type { Me } from '../lib/api'
import { useChat } from '../store/chat'
import { friendsInCall, useHome, usePendingItems } from '../store/home'
import { useSocial } from '../store/social'
import { AddServerModal } from './modals'
import { AddFriendModal, StartCallModal } from './socialModals'

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

/** Home's hub: what matters right now, across servers, conversations and addons. */
export function HomeHub({ me }: { me: Me }): ReactNode {
  // Loads the hub's own data, and keeps it live while it's on screen.
  useEffect(() => {
    useHome.getState().open()
    return () => useHome.getState().close()
  }, [])

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-8 py-7">
        <Header me={me} />
      </div>
    </div>
  )
}

type Dialog = 'call' | 'friend' | 'create' | 'join'

function Header({ me }: { me: Me }): ReactNode {
  const loaded = useHome((s) => s.loaded)
  const friends = useSocial((s) => s.friends)
  const dms = useSocial((s) => s.dms)
  const servers = useChat((s) => s.servers)
  const pending = usePendingItems().length
  const inCall = friendsInCall(friends, servers, dms).size
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const close = (): void => setDialog(null)

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
        <Action icon={Phone} label="Iniciar chamada" primary onClick={() => setDialog('call')} />
        <Action icon={UserPlus} label="Adicionar amigo" onClick={() => setDialog('friend')} />
        <Action icon={Plus} label="Criar servidor" onClick={() => setDialog('create')} />
        <Action icon={Link2} label="Entrar com convite" onClick={() => setDialog('join')} />
      </div>
      {dialog === 'call' && <StartCallModal meId={me.id} onClose={close} />}
      {dialog === 'friend' && <AddFriendModal onClose={close} />}
      {(dialog === 'create' || dialog === 'join') && <AddServerModal initial={dialog} onClose={close} />}
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
