import { AtSign, Reply, X } from 'lucide-react'
import type { ReactNode } from 'react'

import type { Message, ReplyRef } from '../lib/api'
import { EmojiText } from './Emoji'
import { Avatar } from './ui'
import { t } from '../lib/i18n'
import { Trans } from 'react-i18next'


/** How a quoted message starts, on one line; what it carries when it has no text. */
export function replySnippet(ref: Pick<ReplyRef, 'content' | 'media'>): string {
  const text = ref.content.replace(/\s+/g, ' ').trim()
  if (text && ref.media !== 'poll') return text
  return ref.media ? t(`chat.reply.media.${ref.media}`) : ''
}

/** The quote of the original above a reply. Clicking it scrolls to the original and flashes it. */
export function ReplyQuote({
  message,
  nameOf,
  onJump
}: {
  message: Message
  /** Name to show for an author (server nickname); their display name otherwise. */
  nameOf(userId: string): string | null | undefined
  onJump(messageId: number): void
}): ReactNode {
  const ref = message.reply_to
  if (!ref) {
    return (
      <p className="mb-1 flex items-center gap-1.5 text-xs italic text-fg-subtle">
        <Reply size={14} className="shrink-0" /> {t('chat.reply.deleted')}
      </p>
    )
  }
  const name = ref.author ? (nameOf(ref.author.id) ?? ref.author.display_name) : t('chat.reply.removedUser')
  return (
    <button
      type="button"
      onClick={() => onJump(ref.id)}
      title={t('chat.reply.jump')}
      className="mb-1 flex max-w-full items-center gap-1.5 text-xs text-fg-muted hover:text-fg"
    >
      <Reply size={14} className="shrink-0 text-fg-subtle" />
      <Avatar name={name} url={ref.author?.avatar_url} gif={ref.author?.avatar_gif} size={16} />
      <span className="shrink-0 font-semibold">{name}</span>
      <span className="min-w-0 truncate">
        <EmojiText text={replySnippet(ref)} />
      </span>
    </button>
  )
}

/** Above the message box while replying: who to, how the original starts, the mention switch
 * ("@ Mencionar", on by default) and a way out (also Esc). */
export function ReplyBar({
  target,
  name,
  mention,
  onToggleMention,
  onCancel
}: {
  target: Message
  name: string
  /** null: no switch (my own message, or a DM, where every message notifies anyway). */
  mention: boolean | null
  onToggleMention(): void
  onCancel(): void
}): ReactNode {
  const snippet = replySnippet({
    content: target.sticker || target.gif ? '' : target.content,
    media: target.sticker ? 'sticker' : target.gif ? 'gif' : target.embed ? 'poll' : target.attachments[0] ? (target.attachments[0].content_type === 'image/gif' ? 'gif' : target.attachments[0].kind) : null
  })
  return (
    <div className="mb-1.5 flex items-center gap-2 rounded-control border border-line bg-elevated px-3 py-1.5 text-sm">
      <Reply size={16} className="shrink-0 text-fg-subtle" />
      <p className="min-w-0 flex-1 truncate text-fg-muted">
        <Trans i18nKey="chat.reply.replyingTo" values={{ name }} components={{ b: <span className="font-semibold text-fg" /> }} />
        {snippet && (
          <span className="text-fg-subtle">
            {' · '}
            <EmojiText text={snippet} />
          </span>
        )}
      </p>
      {mention !== null && (
        <button
          type="button"
          aria-pressed={mention}
          onClick={onToggleMention}
          title={mention ? t('chat.reply.willNotify') : t('chat.reply.noNotify')}
          className={`flex shrink-0 items-center gap-1 rounded-item px-2 py-0.5 text-xs font-semibold ${
            mention ? 'text-accent-text hover:bg-panel' : 'text-fg-subtle hover:bg-panel hover:text-fg'
          }`}
        >
          <AtSign size={14} /> {mention ? t('chat.reply.mention') : t('chat.reply.noMention')}
        </button>
      )}
      <button type="button" aria-label={t('chat.reply.cancel')} title={t('chat.reply.cancelEsc')} onClick={onCancel} className="shrink-0 rounded-item p-1 text-fg-subtle hover:bg-panel hover:text-fg">
        <X size={16} />
      </button>
    </div>
  )
}
