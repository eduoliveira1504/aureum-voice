import { Plus, SmilePlus, X } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'

import type { Message, Reaction } from '../lib/api'
import { closeContextMenu, contextMenu, Item, Label } from './ContextMenu'
import { Emoji, pickEmoji } from './Emoji'

// Different emojis a message can have (the API says the same).
export const MAX_REACTIONS = 20

/** The quick reactions offered before the full picker. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥']

/** A row of the quick reactions and "+" (the full picker), for the bar's "Reagir" and the top of
 * the message's menu. */
export function QuickReactions({ onPick }: { onPick(emoji: string): void }): ReactNode {
  return (
    <div role="group" aria-label="Reagir" className="flex items-center gap-0.5 px-1 py-0.5">
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`Reagir com ${emoji}`}
          onClick={() => {
            onPick(emoji)
            closeContextMenu()
          }}
          className="flex h-8 w-8 items-center justify-center rounded-item hover:bg-elevated"
        >
          <Emoji emoji={emoji} size={22} />
        </button>
      ))}
      <button
        type="button"
        aria-label="Mais reações"
        title="Mais reações"
        onClick={(e) => {
          pickEmoji(e.currentTarget, onPick)
          closeContextMenu()
        }}
        className="flex h-8 w-8 items-center justify-center rounded-item text-fg-muted hover:bg-elevated hover:text-fg"
      >
        <Plus size={18} />
      </button>
    </div>
  )
}

/** "Ana, Bia e mais 2" for a chip's tooltip. */
export function whoReacted(reaction: Reaction, nameOf: (userId: string) => string, meId: string): string {
  const names = reaction.user_ids.map((id) => (id === meId ? 'você' : nameOf(id)))
  const shown = names.slice(0, 3)
  const more = names.length - shown.length
  const list = more > 0 ? `${shown.join(', ')} e mais ${more}` : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} e ${shown.at(-1)}` : shown[0]
  return `${list[0].toLocaleUpperCase('pt-BR')}${list.slice(1)} ${reaction.count > 1 ? 'reagiram' : 'reagiu'}`
}

/**
 * The chips under a message: emoji and count, mine in the accent color. A click adds or takes back
 * mine; hovering says who. `canAdd`: may start a new emoji ("+"); `canJoin`: may add to one already
 * there. With `onRemove` (MANAGE_MESSAGES), a right click lists who to take away.
 */
export function ReactionChips({
  message,
  meId,
  canAdd,
  canJoin,
  nameOf,
  onReact,
  onRemove
}: {
  message: Message
  meId: string
  canAdd: boolean
  canJoin: boolean
  nameOf(userId: string): string
  onReact(emoji: string, on: boolean): void
  onRemove?: (emoji: string, userId: string) => void
}): ReactNode {
  const reactions = message.reactions ?? []
  if (!reactions.length) return null
  const removeMenu = (reaction: Reaction): ((e: MouseEvent) => void) | undefined => {
    const others = reaction.user_ids.filter((id) => id !== meId)
    if (!onRemove || !others.length) return undefined
    return contextMenu(() => (
      <>
        <Label>Remover reação</Label>
        {others.map((id) => (
          <Item key={id} icon={X} label={nameOf(id)} danger onClick={() => onRemove(reaction.emoji, id)} />
        ))}
      </>
    ))
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => {
        const mine = reaction.user_ids.includes(meId)
        return (
          <button
            key={reaction.emoji}
            type="button"
            aria-pressed={mine}
            aria-label={`${reaction.emoji} ${reaction.count}`}
            title={whoReacted(reaction, nameOf, meId)}
            disabled={!mine && !canJoin}
            onClick={() => onReact(reaction.emoji, !mine)}
            onContextMenu={removeMenu(reaction)}
            className={`flex h-7 items-center gap-1 rounded-full border px-2 text-xs font-semibold tabular-nums transition-colors disabled:cursor-default ${
              mine ? 'border-accent bg-accent/15 text-accent-text' : 'border-line bg-elevated text-fg-muted enabled:hover:border-fg-subtle'
            }`}
          >
            <Emoji emoji={reaction.emoji} size={16} />
            {reaction.count}
          </button>
        )
      })}
      {canAdd && reactions.length < MAX_REACTIONS && (
        <button
          type="button"
          aria-label="Adicionar reação"
          title="Adicionar reação"
          onClick={(e) => pickEmoji(e.currentTarget, (emoji) => onReact(emoji, true))}
          className="flex h-7 items-center rounded-full border border-line px-2 text-fg-subtle hover:border-fg-subtle hover:text-fg"
        >
          <SmilePlus size={15} />
        </button>
      )}
    </div>
  )
}
