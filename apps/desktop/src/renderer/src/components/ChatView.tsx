import { Hash, Pencil, Phone, PhoneMissed, Trash2 } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { ApiError, type Channel, type Me, type Message, type User } from '../lib/api'
import { useReadableColor } from '../store/appearance'
import { useChat, viewChannel } from '../store/chat'
import { useVoice } from '../store/voice'
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
function Linkified({ text, own = false }: { text: string; own?: boolean }): ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      // On the accent-tinted bubble the accent text color can lack contrast: underline instead.
      <a key={i} href={part} target="_blank" rel="noreferrer" className={own ? 'underline' : 'text-accent-text hover:underline'}>
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  )
}

export function ChatView({
  channel,
  me,
  canModerate,
  intro,
  placeholder
}: {
  channel: Channel
  me: Me
  canModerate: boolean
  /** Shown above the first message (defaults to the server channel's welcome). */
  intro?: ReactNode
  placeholder?: string
}): ReactNode {
  const entry = useChat((s) => s.messages[channel.id])
  const loadMessages = useChat((s) => s.loadMessages)
  const markRead = useChat((s) => s.markRead)
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

  // On screen: new messages here are read as they arrive.
  useEffect(() => viewChannel(channel.id), [channel.id])
  useEffect(() => {
    if (entry?.loaded) markRead(channel.id)
  }, [channel.id, entry?.loaded, markRead])

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
    <div className="flex min-w-0 flex-1 flex-col bg-main">
      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto pb-4">
        {entry?.loaded && !entry.hasMore && (
          <div className="px-4 pb-2 pt-10">
            {intro ?? (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-elevated text-fg-muted">
                  <Hash size={36} />
                </div>
                <h3 className="mt-3 text-3xl font-bold">Boas-vindas a #{channel.name}!</h3>
                <p className="mt-1 text-fg-muted">Este é o começo do canal #{channel.name}.</p>
              </>
            )}
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
            !prev.call &&
            prev.author?.id === message.author?.id &&
            date.getTime() - new Date(prev.created_at).getTime() < GROUP_WINDOW_MS
          return (
            <Fragment key={message.id}>
              {newDay && (
                <div className="mx-4 mb-1 mt-5 flex items-center gap-2 text-xs font-semibold text-fg-subtle">
                  <div className="h-px flex-1 bg-line" />
                  {dayFmt.format(date)}
                  <div className="h-px flex-1 bg-line" />
                </div>
              )}
              {message.call ? (
                <CallLine message={message} meId={me.id} />
              ) : (
                <MessageRow
                  message={message}
                  own={message.author?.id === me.id}
                  grouped={grouped}
                  editing={editingId === message.id}
                  canEdit={message.author?.id === me.id}
                  canDelete={message.author?.id === me.id || canModerate}
                  onEdit={() => setEditingId(message.id)}
                  onStopEditing={() => setEditingId(null)}
                  onDelete={() => setDeleting(message)}
                  onOpenProfile={profile.open}
                />
              )}
            </Fragment>
          )
        })}
      </div>

      <Composer channel={channel} placeholder={placeholder ?? `Conversar em #${channel.name}`} />
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

function callDuration(from: string, to: string): string {
  const seconds = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/** The line a private call leaves in its conversation. */
function CallLine({ message, meId }: { message: Message; meId: string }): ReactNode {
  const call = message.call!
  const join = useVoice((s) => s.join)
  const inIt = useVoice((s) => s.phase !== 'idle' && s.channelId === call.channel_id)
  const caller = message.author?.id === meId ? 'Você' : (message.author?.display_name ?? 'Alguém')
  const me = call.participants.find((p) => p.user_id === meId)
  const anyoneJoined = call.participants.some((p) => p.user_id !== call.started_by && p.joined_at)
  const missed = !!call.ended_at && !!me?.rung_at && !me.joined_at && !me.declined_at

  let text: string
  if (!call.ended_at) text = `${caller} começou uma chamada`
  else if (missed) text = `Chamada perdida de ${caller}`
  else if (me?.declined_at && !me.joined_at) text = `Você recusou uma chamada de ${caller}`
  else if (!anyoneJoined) text = caller === 'Você' ? 'Você ligou, mas ninguém atendeu' : `${caller} ligou`
  else text = `${caller} começou uma chamada · ${callDuration(call.started_at, call.ended_at)}`

  const Icon = missed ? PhoneMissed : Phone
  return (
    <div className="mt-4 flex items-center gap-2.5 px-4 text-sm">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-item ${missed ? 'bg-danger/15 text-danger' : call.ended_at ? 'bg-elevated text-fg-muted' : 'bg-success/15 text-success'}`}
      >
        <Icon size={18} />
      </span>
      <span className={missed ? 'font-medium text-danger' : 'text-fg-muted'}>{text}</span>
      <span className="text-xs text-fg-subtle">{formatTimestamp(message.created_at)}</span>
      {!call.ended_at && !inIt && (
        <button
          type="button"
          onClick={() => void join(null, call.channel_id)}
          className="rounded-control bg-accent px-3 py-1 text-xs font-semibold text-on-accent hover:bg-accent-hover"
        >
          Entrar
        </button>
      )}
    </div>
  )
}

function MessageRow({
  message,
  own,
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
  /** Written by the signed-in user: shown on the right, without avatar or name. */
  own: boolean
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
  const nameColor = useReadableColor(author?.accent_color)
  const openProfile = (e: { currentTarget: Element }): void => {
    if (author) onOpenProfile(author, e.currentTarget)
  }

  return (
    <div className={`group relative flex gap-2.5 px-4 ${grouped ? 'mt-1' : 'mt-4'} ${own ? 'flex-row-reverse' : ''}`}>
      {!own && (
        <div className="w-9 shrink-0">
          {!grouped && (
            <button type="button" aria-label={`Perfil de ${name}`} disabled={!author} onClick={openProfile}>
              <Avatar name={name} url={author?.avatar_url} size={36} shape="rounded" />
            </button>
          )}
        </div>
      )}
      <div className={`relative flex min-w-0 max-w-[min(75%,640px)] flex-col ${own ? 'items-end' : 'items-start'} ${editing ? 'w-full' : ''}`}>
        {!grouped && (
          <div className={`mb-1 flex items-baseline gap-2 ${own ? 'flex-row-reverse' : ''}`}>
            {!own && (
              <button
                type="button"
                disabled={!author}
                onClick={openProfile}
                className="text-sm font-semibold hover:underline disabled:no-underline"
                style={nameColor ? { color: nameColor } : undefined}
              >
                {name}
              </button>
            )}
            <span className="text-xs text-fg-subtle">{formatTimestamp(message.created_at)}</span>
          </div>
        )}
        {editing ? (
          <EditBox message={message} onDone={onStopEditing} />
        ) : (
          <div
            title={grouped ? formatTimestamp(message.created_at) : undefined}
            className={`rounded-control px-3 py-2 ${own ? 'rounded-tr-item bg-bubble-own' : 'rounded-tl-item bg-elevated'}`}
          >
            <p className="select-text whitespace-pre-wrap break-words leading-relaxed text-fg">
              <Linkified text={message.content} own={own} />
              {message.edited_at && <span className="ml-1 text-[11px] text-fg-subtle">(editada)</span>}
            </p>
          </div>
        )}
        {!editing && (canEdit || canDelete) && (
          <div
            className={`absolute bottom-0 hidden overflow-hidden rounded-item border border-line bg-panel text-fg-muted shadow group-hover:flex ${
              own ? 'right-full mr-2' : 'left-full ml-2'
            }`}
          >
            {canEdit && (
              <button type="button" title="Editar" aria-label="Editar" onClick={onEdit} className="px-2 py-1.5 hover:bg-elevated hover:text-fg">
                <Pencil size={16} />
              </button>
            )}
            {canDelete && (
              <button type="button" title="Excluir" aria-label="Excluir" onClick={onDelete} className="px-2 py-1.5 hover:bg-elevated hover:text-danger">
                <Trash2 size={16} />
              </button>
            )}
          </div>
        )}
      </div>
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
    <div className="w-full">
      <AutoTextarea autoFocus value={value} onChange={setValue} onKeyDown={onKeyDown} />
      <p className="mt-1 text-xs text-fg-subtle">
        {error ? <span className="text-danger">Falha ao salvar. </span> : null}
        Esc para <button type="button" className="text-accent-text hover:underline" onClick={onDone}>cancelar</button> • Enter
        para <button type="button" className="text-accent-text hover:underline" onClick={save}>salvar</button>
      </p>
    </div>
  )
}

function Composer({ channel, placeholder }: { channel: Channel; placeholder: string }): ReactNode {
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
    } catch (err) {
      setValue(content) // give the text back so nothing is lost
      setError(
        err instanceof ApiError && err.status === 403
          ? 'Só amigos podem conversar por mensagem direta.'
          : 'Não foi possível enviar a mensagem.'
      )
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
        placeholder={placeholder}
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
    // scrollHeight leaves out the border; without it a scrollbar shows up on one-line text.
    const border = el.offsetHeight - el.clientHeight
    el.style.height = `${Math.min(el.scrollHeight + border, 300)}px`
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
      className="block w-full resize-none rounded-control border border-line bg-elevated px-4 py-2.5 leading-relaxed text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60"
    />
  )
}
