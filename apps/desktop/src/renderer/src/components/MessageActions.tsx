import { Copy, EllipsisVertical, EyeOff, Forward, Link, Pencil, Reply, SmilePlus, Trash2, type LucideIcon } from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'

import type { Message } from '../lib/api'
import { useChat } from '../store/chat'
import { channelTab, useNav } from '../store/nav'
import { useSocial } from '../store/social'
import { copy, Item, openMenuAt, Separator, toast } from './ContextMenu'

/**
 * What can be done to a message, in three places that offer the same things: the bar that shows
 * on hover (or focus), its "…" menu and the right-click menu. A missing handler means the action
 * isn't allowed here, and it doesn't show.
 */
export interface MessageActions {
  onReact?: (anchor: Element) => void
  onReply?: () => void
  onForward?: () => void
  onEdit?: () => void
  onDelete?: () => void
}

/** A message's link: pasted in any conversation of the app, it opens the message. */
export const messageLink = (message: Pick<Message, 'channel_id' | 'id'>): string => `aureum://mensagem/${message.channel_id}/${message.id}`

export const MESSAGE_LINK = /aureum:\/\/mensagem\/([0-9a-f-]{36})\/(\d+)/

/** Opens a message link where the message lives (a server channel or a conversation), scrolled
 * to it. Says so when it isn't somewhere the user can see. */
export function openMessageLink(channelId: string, messageId: number): void {
  const server = Object.values(useChat.getState().servers).find((s) => s.channels.some((c) => c.id === channelId))
  if (server) useNav.getState().openTab(server.id, channelTab(channelId))
  else if (useSocial.getState().dms[channelId]) useNav.getState().openHome(channelId)
  else return toast('Você não tem acesso a essa mensagem.')
  useChat.getState().focusMessage(channelId, messageId)
}

/** The menu's items, for "…" and for a right click. */
export function MessageMenu({ message, actions }: { message: Message; actions: MessageActions }): ReactNode {
  const { onReply, onForward, onEdit, onDelete } = actions
  return (
    <>
      {onReply && <Item icon={Reply} label="Responder" hint="R" onClick={onReply} />}
      {onForward && <Item icon={Forward} label="Encaminhar" onClick={onForward} />}
      {onEdit && <Item icon={Pencil} label="Editar" hint="E" onClick={onEdit} />}
      {(onReply || onForward || onEdit) && <Separator />}
      {message.content && <Item icon={Copy} label="Copiar texto" onClick={() => copy(message.content, 'Texto copiado')} />}
      <Item icon={Link} label="Copiar link da mensagem" onClick={() => copy(messageLink(message), 'Link copiado')} />
      <Item
        icon={EyeOff}
        label="Marcar como não lida"
        onClick={() => useChat.getState().markUnread(message.channel_id, message.id).catch(() => toast('Não foi possível marcar como não lida.'))}
      />
      {onDelete && (
        <>
          <Separator />
          <Item icon={Trash2} label="Apagar" hint="Del" danger onClick={onDelete} />
        </>
      )}
    </>
  )
}

function BarButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick(target: Element): void }): ReactNode {
  return (
    <button type="button" title={label} aria-label={label} onClick={(e) => onClick(e.currentTarget)} className="px-2 py-1.5 hover:bg-elevated hover:text-fg">
      <Icon size={16} />
    </button>
  )
}

/** The bar at the message's top right corner, shown while the pointer is over it (group-hover)
 * or it has focus. */
export function MessageActionBar({ message, actions }: { message: Message; actions: MessageActions }): ReactNode {
  const { onReact, onReply, onForward } = actions
  return (
    <div
      role="toolbar"
      aria-label="Ações da mensagem"
      className="absolute -top-4 right-4 z-10 hidden overflow-hidden rounded-item border border-line bg-panel text-fg-muted shadow group-focus-within:flex group-hover:flex"
    >
      {onReact && <BarButton icon={SmilePlus} label="Reagir" onClick={onReact} />}
      {onReply && <BarButton icon={Reply} label="Responder" onClick={onReply} />}
      {onForward && <BarButton icon={Forward} label="Encaminhar" onClick={onForward} />}
      <BarButton icon={EllipsisVertical} label="Mais opções" onClick={(target) => openMenuAt(target, () => <MessageMenu message={message} actions={actions} />)} />
    </div>
  )
}

/** Shortcuts while the message has focus: R replies, E edits, Del deletes (it asks first). */
export function messageKeys(actions: MessageActions) {
  return (e: KeyboardEvent): void => {
    // Typing in the message's own fields (editing it) isn't a shortcut.
    if (e.target !== e.currentTarget || e.ctrlKey || e.altKey || e.metaKey) return
    const run = e.key === 'Delete' ? actions.onDelete : e.key.toLowerCase() === 'r' ? actions.onReply : e.key.toLowerCase() === 'e' ? actions.onEdit : undefined
    if (!run) return
    e.preventDefault()
    run()
  }
}
