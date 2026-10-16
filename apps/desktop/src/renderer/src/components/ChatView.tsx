import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import type { Channel, Me, Message, User } from '../lib/api'
import { useChat } from '../store/chat'
import { ConfirmModal } from './modals'
import { useProfilePopover } from './ProfileCard'
import { Avatar } from './ui'

const MAX_LENGTH = 4000
const GROUP_WINDOW_MS = 5 * 60 * 1000

const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString()
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameDay(date, new Date())) return `Hoje às ${timeFmt.format(date)}`
  if (sameDay(date, yesterday)) return `Ontem às ${timeFmt.format(date)}`
  return `${dateFmt.format(date)} ${timeFmt.format(date)}`
}

/** Renders text with http(s) links made clickable (they open in the system browser). */
function Linkified({ text }: { text: string }): ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  )
}

export function ChatView({ channel, me, canModerate }: { channel: Channel; me: Me; canModerate: boolean }): ReactNode {
  const entry = useChat((s) => s.messages[channel.id])
  const loadMessages = useChat((s) => s.loadMessages)
  const deleteMessage = useChat((s) => s.deleteMessage)
  const items = entry?.items
  const [editingId, setEditingId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<Message | null>(null)
  const [loadError, setLoadError] = useState(false)
  const profile = useProfilePopover()

  const listRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const keepOffsetFromBottom = useRef<number | null>(null)

  useEffect(() => {
    atBottom.current = true
    setEditingId(null)
  }, [channel.id])

  useEffect(() => {
    if (entry?.loaded || entry?.loading) return
    setLoadError(false)
    loadMessages(channel.id).catch(() => setLoadError(true))
  }, [channel.id, entry?.loaded, entry?.loading, loadMessages])

  // Keep the view pinned to the bottom for new messages, and stable when older ones load above.
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (keepOffsetFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - keepOffsetFromBottom.current
      keepOffsetFromBottom.current = null
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [items])

  function onScroll(): void {
    const el = listRef.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (el.scrollTop < 120 && entry?.hasMore && !entry.loading) {
      keepOffsetFromBottom.current = el.scrollHeight - el.scrollTop
      loadMessages(channel.id, true).catch(() => (keepOffsetFromBottom.current = null))
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-surface-2">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-surface-0 px-4 shadow-sm">
        <span className="text-xl text-fg-subtle">#</span>
        <h2 className="font-semibold">{channel.name}</h2>
      </header>

      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto pb-4">
        {entry?.loaded && !entry.hasMore && (
          <div className="px-4 pb-2 pt-10">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-3 text-4xl text-fg-muted">#</div>
            <h3 className="mt-3 text-3xl font-bold">Boas-vindas a #{channel.name}!</h3>
            <p className="mt-1 text-fg-muted">Este é o começo do canal #{channel.name}.</p>
          </div>
        )}
        {entry?.loading && <p className="py-3 text-center text-sm text-fg-subtle">Carregando mensagens…</p>}
        {loadError && (
          <p className="py-3 text-center text-sm text-danger">
            Não foi possível carregar as mensagens.{' '}
            <button type="button" className="underline" onClick={() => loadMessages(channel.id).then(() => setLoadError(false), () => {})}>
              Tentar de novo
            </button>
          </p>
        )}

        {items?.map((message, i) => {
          const prev = items[i - 1]
          const date = new Date(message.created_at)
          const newDay = !prev || !sameDay(new Date(prev.created_at), date)
          const grouped =
            !newDay &&
            prev.author?.id === message.author?.id &&
            date.getTime() - new Date(prev.created_at).getTime() < GROUP_WINDOW_MS
          return (
            <Fragment key={message.id}>
              {newDay && (
                <div className="mx-4 mb-1 mt-5 flex items-center gap-2 text-xs font-semibold text-fg-subtle">
                  <div className="h-px flex-1 bg-surface-3" />
                  {dayFmt.format(date)}
                  <div className="h-px flex-1 bg-surface-3" />
                </div>
              )}
              <MessageRow
                message={message}
                grouped={grouped}
                editing={editingId === message.id}
                canEdit={message.author?.id === me.id}
                canDelete={message.author?.id === me.id || canModerate}
                onEdit={() => setEditingId(message.id)}
                onStopEditing={() => setEditingId(null)}
                onDelete={() => setDeleting(message)}
                onOpenProfile={profile.open}
              />
            </Fragment>
          )
        })}
      </div>

      <Composer channel={channel} />
      {profile.popover}

      {deleting && (
        <ConfirmModal
          title="Excluir mensagem"
          message="Tem certeza? Isso não pode ser desfeito."
          confirmLabel="Excluir"
          onConfirm={() => deleteMessage(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

function MessageRow({
  message,
  grouped,
  editing,
  canEdit,
  canDelete,
  onEdit,
  onStopEditing,
  onDelete,
  onOpenProfile
}: {
  message: Message
  grouped: boolean
  editing: boolean
  canEdit: boolean
  canDelete: boolean
  onEdit(): void
  onStopEditing(): void
  onDelete(): void
  onOpenProfile(user: User, target: Element): void
}): ReactNode {
  const author = message.author
  const name = author?.display_name ?? 'Usuário removido'
  const time = new Date(message.created_at)

  return (
    <div className={`group relative flex gap-4 px-4 py-0.5 pr-16 hover:bg-surface-0/20 ${grouped ? '' : 'mt-4'}`}>
      <div className="w-10 shrink-0">
        {grouped ? (
          <span className="invisible block pt-1 text-right text-[11px] text-fg-subtle group-hover:visible">{timeFmt.format(time)}</span>
        ) : (
          <button type="button" aria-label={`Perfil de ${name}`} disabled={!author} onClick={(e) => author && onOpenProfile(author, e.currentTarget)}>
            <Avatar name={name} url={author?.avatar_url} size={40} />
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <button
              type="button"
              disabled={!author}
              onClick={(e) => author && onOpenProfile(author, e.currentTarget)}
              className="font-medium hover:underline disabled:no-underline"
              style={author?.accent_color ? { color: author.accent_color } : undefined}
            >
              {name}
            </button>
            <span className="text-xs text-fg-subtle">{formatTimestamp(message.created_at)}</span>
          </div>
        )}
        {editing ? (
          <EditBox message={message} onDone={onStopEditing} />
        ) : (
          <p className="select-text whitespace-pre-wrap break-words leading-relaxed text-fg/95">
            <Linkified text={message.content} />
            {message.edited_at && <span className="ml-1 text-[11px] text-fg-subtle">(editada)</span>}
          </p>
        )}
      </div>

      {!editing && (canEdit || canDelete) && (
        <div className="absolute -top-3 right-4 hidden overflow-hidden rounded border border-surface-0 bg-surface-2 shadow group-hover:flex">
          {canEdit && (
            <button type="button" title="Editar" onClick={onEdit} className="px-2 py-1 text-sm hover:bg-surface-3">
              ✏️
            </button>
          )}
          {canDelete && (
            <button type="button" title="Excluir" onClick={onDelete} className="px-2 py-1 text-sm hover:bg-surface-3">
              🗑️
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function EditBox({ message, onDone }: { message: Message; onDone(): void }): ReactNode {
  const editMessage = useChat((s) => s.editMessage)
  const [value, setValue] = useState(message.content)
  const [error, setError] = useState(false)

  async function save(): Promise<void> {
    const content = value.trim()
    if (!content || content === message.content) return onDone()
    try {
      await editMessage(message.id, content)
      onDone()
    } catch {
      setError(true)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Escape') onDone()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void save()
    }
  }

  return (
    <div className="mt-1">
      <AutoTextarea autoFocus value={value} onChange={setValue} onKeyDown={onKeyDown} />
      <p className="mt-1 text-xs text-fg-subtle">
        {error ? <span className="text-danger">Falha ao salvar. </span> : null}
        Esc para <button type="button" className="text-sky-400 hover:underline" onClick={onDone}>cancelar</button> • Enter
        para <button type="button" className="text-sky-400 hover:underline" onClick={save}>salvar</button>
      </p>
    </div>
  )
}

function Composer({ channel }: { channel: Channel }): ReactNode {
  const sendMessage = useChat((s) => s.sendMessage)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const value = drafts[channel.id] ?? ''
  const setValue = (v: string): void => setDrafts((d) => ({ ...d, [channel.id]: v }))

  async function send(): Promise<void> {
    const content = value.trim()
    if (!content) return
    if (content.length > MAX_LENGTH) return setError(`Máximo de ${MAX_LENGTH} caracteres.`)
    setValue('')
    setError(null)
    try {
      await sendMessage(channel.id, content)
    } catch {
      setValue(content) // give the text back so nothing is lost
      setError('Não foi possível enviar a mensagem.')
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="shrink-0 px-4 pb-6">
      {error && <p className="mb-1 text-xs text-danger">{error}</p>}
      <AutoTextarea
        key={channel.id}
        autoFocus
        value={value}
        onChange={setValue}
        onKeyDown={onKeyDown}
        placeholder={`Conversar em #${channel.name}`}
      />
      {value.length > MAX_LENGTH - 200 && (
        <p className={`mt-1 text-right text-xs ${value.length > MAX_LENGTH ? 'text-danger' : 'text-fg-subtle'}`}>
          {value.length}/{MAX_LENGTH}
        </p>
      )}
    </div>
  )
}

function AutoTextarea({
  value,
  onChange,
  onKeyDown,
  placeholder,
  autoFocus
}: {
  value: string
  onChange(v: string): void
  onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void
  placeholder?: string
  autoFocus?: boolean
}): ReactNode {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      rows={1}
      autoFocus={autoFocus}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      className="block w-full resize-none rounded-lg bg-surface-3 px-4 py-2.5 leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
    />
  )
}
