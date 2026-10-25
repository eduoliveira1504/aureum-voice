import { Check, Hash, Search } from 'lucide-react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'

import { ApiError, type Message } from '../lib/api'
import { channelPermissions, Perm } from '../lib/permissions'
import { useChat } from '../store/chat'
import { dmPeer, dmTitle, useSocial } from '../store/social'
import { toast } from './ContextMenu'
import { FormError, Modal, ModalBody } from './Modal'
import { Avatar, cn, GroupAvatar, inputClass, PrimaryButton, ServerIcon } from './ui'

/** At most this many conversations per forward (the API says the same). */
export const MAX_FORWARD_TARGETS = 5

export interface ForwardTarget {
  channelId: string
  name: string
  /** Under the name: the server of a channel, "Grupo" or "Mensagem direta". */
  where: string
  icon: ReactNode
}

const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')

/**
 * Where the user can send this message: their DMs (with friends) and groups, then the server text
 * channels where they may send messages, and files too when it has any. The API checks it again.
 */
export function useForwardTargets(message: Message, meId: string): ForwardTarget[] {
  const dms = useSocial((s) => s.dms)
  const friends = useSocial((s) => s.friends)
  const servers = useChat((s) => s.servers)
  const order = useChat((s) => s.order)
  return useMemo(() => {
    const needed = Perm.SEND_MESSAGES | (message.attachments.length ? Perm.ATTACH_FILES : 0)
    const out: ForwardTarget[] = []
    for (const dm of Object.values(dms).sort((a, b) => b.last_message_id - a.last_message_id)) {
      if (dm.official) continue // read-only
      const peer = dmPeer(dm, meId)
      if (peer && friends[peer.id]?.kind !== 'friend') continue // only friends can write
      out.push({
        channelId: dm.id,
        name: dmTitle(dm, meId),
        where: dm.type === 'group_dm' ? 'Grupo' : 'Mensagem direta',
        icon: peer ? <Avatar name={peer.display_name} url={peer.avatar_url} size={28} /> : <GroupAvatar url={dm.icon_url} size={28} />
      })
    }
    for (const id of order) {
      const server = servers[id]
      if (!server) continue
      for (const channel of server.channels) {
        if (channel.type !== 'text') continue
        if ((channelPermissions(server, channel, meId) & needed) !== needed) continue
        out.push({ channelId: channel.id, name: `#${channel.name}`, where: server.name, icon: <ServerIcon name={server.name} url={server.icon_url} size={28} /> })
      }
    }
    return out
  }, [dms, friends, servers, order, message.attachments.length, meId])
}

/** "Encaminhar": pick up to 5 conversations, add an optional comment, send. */
export function ForwardModal({ message, meId, onClose }: { message: Message; meId: string; onClose(): void }): ReactNode {
  const targets = useForwardTargets(message, meId)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const shown = query.trim() ? targets.filter((t) => fold(`${t.name} ${t.where}`).includes(fold(query.trim()))) : targets
  const full = picked.length >= MAX_FORWARD_TARGETS

  const toggle = (id: string): void => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : full ? list : [...list, id]))

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!picked.length) return setError('Escolha pelo menos uma conversa.')
    setBusy(true)
    setError(null)
    try {
      await useChat.getState().forwardMessage(message.id, picked, comment.trim())
      toast(picked.length === 1 ? 'Mensagem encaminhada!' : `Encaminhada para ${picked.length} conversas!`)
      onClose()
    } catch (err) {
      setBusy(false)
      setError(
        err instanceof ApiError && err.status === 429
          ? 'Muitos encaminhamentos seguidos. Espere um pouco.'
          : err instanceof ApiError && err.status === 403
            ? 'Você não pode enviar em uma das conversas escolhidas.'
            : 'Não foi possível encaminhar.'
      )
    }
  }

  return (
    <Modal title="Encaminhar mensagem" subtitle={`Até ${MAX_FORWARD_TARGETS} conversas de uma vez.`} onClose={onClose} tall>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar conversa ou canal" aria-label="Buscar" className={cn(inputClass, 'pl-9')} />
        </div>
        <ModalBody>
          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-subtle">{targets.length ? 'Nada encontrado.' : 'Nenhuma conversa onde você possa enviar.'}</p>
          ) : (
            <ul className="space-y-0.5">
              {shown.map((t) => {
                const on = picked.includes(t.channelId)
                return (
                  <li key={t.channelId}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={!on && full}
                      onClick={() => toggle(t.channelId)}
                      className="flex w-full items-center gap-3 rounded-item px-2 py-1.5 text-left hover:bg-elevated disabled:opacity-50"
                    >
                      {t.icon}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{t.name}</span>
                        <span className="flex items-center gap-1 truncate text-xs text-fg-subtle">
                          {t.name.startsWith('#') && <Hash size={11} />}
                          {t.where}
                        </span>
                      </span>
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}>
                        {on && <Check size={14} strokeWidth={3} />}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </ModalBody>
        <input value={comment} maxLength={4000} onChange={(e) => setComment(e.target.value)} placeholder="Comentário (opcional)" aria-label="Comentário" className={inputClass} />
        <FormError message={error} />
        <PrimaryButton type="submit" disabled={busy || !picked.length}>
          {busy ? 'Encaminhando…' : picked.length > 1 ? `Encaminhar para ${picked.length}` : 'Encaminhar'}
        </PrimaryButton>
      </form>
    </Modal>
  )
}
