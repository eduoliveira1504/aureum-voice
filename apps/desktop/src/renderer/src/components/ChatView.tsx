import { Hash, Paperclip, Pencil, Phone, PhoneMissed, Plus, Trash2 } from 'lucide-react'
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from 'react'

import { addonIcon } from '../addons/registry'
import { ApiError, uploadFile, type Attachment, type Channel, type Me, type Message, type User } from '../lib/api'
import { seedAttachment } from '../lib/attachments'
import { useReadableColor } from '../store/appearance'
import { useChat, viewChannel } from '../store/chat'
import { channelTab, useNav } from '../store/nav'
import { useSocial } from '../store/social'
import { useVoice } from '../store/voice'
import { MessageAttachments, PendingFiles, type PendingFile } from './Attachments'
import { TopBadge } from './Badge'
import { ConfirmModal } from './modals'
import { useProfilePopover } from './ProfileCard'
import { Avatar } from './ui'
import { userContextMenu } from './UserMenu'

const MAX_LENGTH = 4000
const MAX_FILES = 10
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
// Same rule as the API (app/reads.py): what counts as an @mention.
const MENTION = /(?<![\w.])@([A-Za-z0-9_.]{3,32})/g

/** Turns @username into the person's mention, when they're someone in this conversation. */
function withMentions(text: string, mention: ((username: string) => ReactNode) | undefined): ReactNode[] {
  if (!mention) return [text]
  const out: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(MENTION)) {
    const username = match[1].replace(/\.+$/, '') // a sentence's final dot isn't part of it
    const node = mention(username)
    if (!node) continue
    out.push(text.slice(last, match.index), <Fragment key={match.index}>{node}</Fragment>)
    last = match.index + 1 + username.length
  }
  out.push(text.slice(last))
  return out
}

/** Renders text with http(s) links made clickable (they open in the system browser) and
 * @mentions of people in the conversation. */
function Linkified({ text, own = false, mention }: { text: string; own?: boolean; mention?: (username: string) => ReactNode }): ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      // On the accent-tinted bubble the accent text color can lack contrast: underline instead.
      <a key={i} href={part} target="_blank" rel="noreferrer" className={own ? 'underline' : 'text-accent-text hover:underline'}>
        {part}
      </a>
    ) : (
      <Fragment key={i}>{withMentions(part, mention)}</Fragment>
    )
  )
}

/** An @mention: opens the person's profile, and their menu on right click. */
function Mention({ user, own, onOpen, onMenu }: { user: User; own: boolean; onOpen(target: Element): void; onMenu(e: MouseEvent): void }): ReactNode {
  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget)}
      onContextMenu={onMenu}
      className={`rounded-sm px-0.5 font-medium ${own ? 'underline' : 'bg-accent/15 text-accent-text hover:underline'}`}
    >
      @{user.username}
    </button>
  )
}

export function ChatView({
  channel,
  me,
  canModerate,
  canSend = true,
  canAttach = true,
  nameColorOf,
  nameOf,
  intro,
  placeholder
}: {
  channel: Channel
  me: Me
  /** Can delete other people's messages. */
  canModerate: boolean
  canSend?: boolean
  /** Can send files (ATTACH_FILES in servers). */
  canAttach?: boolean
  /** Color for an author's name (their strongest colored role); their profile color otherwise. */
  nameColorOf?: (userId: string) => string | null
  /** Name to show for an author (their server nickname); their display name otherwise. */
  nameOf?: (userId: string) => string | null
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
  const [dropping, setDropping] = useState(false)
  const addFiles = useRef<(files: File[]) => void>(() => {})
  const profile = useProfilePopover()
  const serverMembers = useChat((s) => (channel.server_id ? s.servers[channel.server_id]?.members : undefined))
  const dmMembers = useSocial((s) => (channel.server_id ? undefined : s.dms[channel.id]?.members))
  const byUsername = useMemo(
    () => new Map([...(serverMembers ?? []), ...(dmMembers ?? [])].map(({ user }) => [user.username.toLowerCase(), user])),
    [serverMembers, dmMembers]
  )
  const mentionFor =
    (own: boolean) =>
    (username: string): ReactNode => {
      const user = byUsername.get(username.toLowerCase())
      if (!user) return null
      return (
        <Mention
          user={user}
          own={own}
          onOpen={(target) => profile.open(user, target)}
          onMenu={userContextMenu(user, me.id, channel.server_id)}
        />
      )
    }
  const acceptsFiles = canSend && canAttach
  const isFileDrag = (e: DragEvent): boolean => acceptsFiles && e.dataTransfer.types.includes('Files')

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
    // min-h-0 on both: in a column, a flex item otherwise grows to fit its messages instead of
    // scrolling them, and pushes whatever sits next to it (a call) out of view.
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-main"
      onDragOver={(e) => {
        if (!isFileDrag(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropping(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={(e) => {
        if (!isFileDrag(e)) return
        e.preventDefault()
        setDropping(false)
        addFiles.current([...e.dataTransfer.files])
      }}
    >
      {dropping && (
        <div className="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center gap-2 rounded-control border-2 border-dashed border-accent bg-main/90 text-center">
          <Paperclip size={28} className="text-accent-text" />
          <p className="font-semibold">Solte para anexar</p>
          <p className="text-sm text-fg-muted">Até {MAX_FILES} arquivos por mensagem</p>
        </div>
      )}
      <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto pb-4">
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
            !prev.system &&
            !message.system &&
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
              ) : message.system ? (
                <SystemLine
                  message={message}
                  serverId={channel.server_id}
                  authorName={message.author ? (nameOf?.(message.author.id) ?? message.author.display_name) : 'Alguém'}
                  onDelete={message.author?.id === me.id || canModerate ? () => setDeleting(message) : undefined}
                />
              ) : (
                <MessageRow
                  message={message}
                  own={message.author?.id === me.id}
                  grouped={grouped}
                  editing={editingId === message.id}
                  canEdit={message.author?.id === me.id && !!message.content}
                  canDelete={message.author?.id === me.id || canModerate}
                  onEdit={() => setEditingId(message.id)}
                  onStopEditing={() => setEditingId(null)}
                  onDelete={() => setDeleting(message)}
                  onOpenProfile={profile.open}
                  onAuthorMenu={message.author ? userContextMenu(message.author, me.id, channel.server_id) : undefined}
                  mention={mentionFor(message.author?.id === me.id)}
                  nameColor={message.author ? nameColorOf?.(message.author.id) : null}
                  authorName={message.author ? nameOf?.(message.author.id) : null}
                />
              )}
            </Fragment>
          )
        })}
      </div>

      {canSend ? (
        <Composer
          channel={channel}
          canAttach={canAttach}
          addFilesRef={addFiles}
          placeholder={placeholder ?? `Conversar em #${channel.name}`}
        />
      ) : (
        <p className="mx-4 mb-6 shrink-0 rounded-control border border-line bg-elevated px-4 py-2.5 text-sm text-fg-subtle">
          Você não tem permissão para enviar mensagens neste canal.
        </p>
      )}
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

/** A line an addon posts about what happened in it ("Ana moveu “Login” para Feito"). Quick runs
 * of actions by the same person come as one message with several lines. */
function SystemLine({
  message,
  serverId,
  authorName,
  onDelete
}: {
  message: Message
  serverId: string | null
  authorName: string
  onDelete?: () => void
}): ReactNode {
  const system = message.system!
  const source = useChat((s) => (serverId ? s.servers[serverId]?.channels.find((c) => c.id === system.source_channel_id) : undefined))
  const openTab = useNav((s) => s.openTab)
  const Icon = addonIcon(system.addon_key)
  const [first, ...rest] = system.lines
  const where = source && serverId && (
    <>
      {' · em '}
      <button type="button" onClick={() => openTab(serverId, channelTab(source.id))} className="font-medium text-fg hover:underline">
        {source.name}
      </button>
    </>
  )
  return (
    <div className="group mt-4 flex items-start gap-2.5 px-4 text-sm">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-item bg-elevated text-fg-muted">
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1 pt-2 text-fg-muted">
        <p>
          <span className="font-semibold text-fg">{authorName}</span>
          {rest.length === 0 && ` ${first}`}
          {where}
          <span className="ml-2 text-xs text-fg-subtle">{formatTimestamp(message.created_at)}</span>
        </p>
        {rest.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {system.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
      </div>
      {onDelete && (
        <button
          type="button"
          aria-label="Excluir"
          onClick={onDelete}
          className="mt-1.5 rounded-item p-1.5 text-fg-subtle opacity-0 hover:bg-elevated hover:text-danger focus:opacity-100 group-hover:opacity-100"
        >
          <Trash2 size={16} />
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
  onOpenProfile,
  onAuthorMenu,
  mention,
  nameColor: roleNameColor,
  authorName
}: {
  message: Message
  /** Written by the signed-in user: shown on the right, mirrored, with their avatar but no name. */
  own: boolean
  grouped: boolean
  editing: boolean
  canEdit: boolean
  canDelete: boolean
  onEdit(): void
  onStopEditing(): void
  onDelete(): void
  onOpenProfile(user: User, target: Element): void
  /** Right click on the author: their menu. */
  onAuthorMenu?: (e: MouseEvent) => void
  /** Renders an @mention (null when it isn't someone here). */
  mention?: (username: string) => ReactNode
  nameColor?: string | null
  authorName?: string | null
}): ReactNode {
  const author = message.author
  const name = authorName || (author?.display_name ?? 'Usuário removido')
  const nameColor = useReadableColor(roleNameColor ?? author?.accent_color)
  const openProfile = (e: { currentTarget: Element }): void => {
    if (author) onOpenProfile(author, e.currentTarget)
  }

  return (
    <div className={`group relative flex gap-2.5 px-4 ${grouped ? 'mt-1' : 'mt-4'} ${own ? 'flex-row-reverse' : ''}`}>
      {/* Own messages too: the row is mirrored, so the avatar ends up on the right. */}
      <div className="w-9 shrink-0">
        {!grouped && (
          <button type="button" aria-label={`Perfil de ${name}`} disabled={!author} onClick={openProfile} onContextMenu={onAuthorMenu}>
            <Avatar name={name} url={author?.avatar_url} size={36} shape="rounded" />
          </button>
        )}
      </div>
      <div className={`relative flex min-w-0 max-w-[min(75%,640px)] flex-col ${own ? 'items-end' : 'items-start'} ${editing ? 'w-full' : ''}`}>
        {!grouped && (
          <div className={`mb-1 flex items-baseline gap-2 ${own ? 'flex-row-reverse' : ''}`}>
            {!own && (
              <button
                type="button"
                disabled={!author}
                onClick={openProfile}
                onContextMenu={onAuthorMenu}
                className="text-sm font-semibold hover:underline disabled:no-underline"
                style={nameColor ? { color: nameColor } : undefined}
              >
                {name}
              </button>
            )}
            {!own && author && <TopBadge badges={author.badges} size={14} />}
            <span className="text-xs text-fg-subtle">{formatTimestamp(message.created_at)}</span>
          </div>
        )}
        {editing ? (
          <EditBox message={message} onDone={onStopEditing} />
        ) : (
          message.content && (
            <div
              title={grouped ? formatTimestamp(message.created_at) : undefined}
              className={`rounded-control px-3 py-2 ${own ? 'rounded-tr-item bg-bubble-own' : 'rounded-tl-item bg-elevated'}`}
            >
              <p className="select-text whitespace-pre-wrap break-words leading-relaxed text-fg">
                <Linkified text={message.content} own={own} mention={mention} />
                {message.edited_at && <span className="ml-1 text-[11px] text-fg-subtle">(editada)</span>}
              </p>
            </div>
          )
        )}
        {!editing && message.attachments.length > 0 && <MessageAttachments attachments={message.attachments} own={own} />}
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

let pendingKeys = 0

function uploadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 413) return 'Grande demais'
    if (err.status === 403) return 'Sem permissão'
    if (err.status === 429) return 'Arquivos demais esperando'
  }
  return 'Falhou o envio'
}

/** Pasted screenshots come named "image.png": give them a readable, distinct name. */
function pastedName(file: File): string {
  if (file.name && file.name !== 'image.png') return file.name
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `imagem-${stamp}.${file.type.split('/')[1] || 'png'}`
}

function Composer({
  channel,
  canAttach,
  addFilesRef,
  placeholder
}: {
  channel: Channel
  canAttach: boolean
  /** Set here so the whole conversation can take dropped files. */
  addFilesRef: { current: (files: File[]) => void }
  placeholder: string
}): ReactNode {
  const sendMessage = useChat((s) => s.sendMessage)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<PendingFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const value = drafts[channel.id] ?? ''
  const setValue = (v: string): void => setDrafts((d) => ({ ...d, [channel.id]: v }))
  const filesRef = useRef(files)
  filesRef.current = files

  const patchFile = (key: string, change: Partial<PendingFile>): void =>
    setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...change } : f)))

  function addFiles(list: File[], named: (f: File) => string = (f) => f.name): void {
    if (!canAttach || !list.length) return
    const room = MAX_FILES - filesRef.current.length
    if (room <= 0) return setError(`Até ${MAX_FILES} arquivos por mensagem.`)
    setError(list.length > room ? `Até ${MAX_FILES} arquivos por mensagem.` : null)
    const added = list.slice(0, room).map((file): PendingFile => {
      const key = `f${++pendingKeys}`
      const name = named(file)
      const upload = uploadFile<Attachment>(`/channels/${channel.id}/attachments`, file, name, (progress) => patchFile(key, { progress }))
      upload.done.then(
        (attachment) => patchFile(key, { status: 'done', progress: 1, attachment }),
        (err) => {
          if (!(err instanceof DOMException && err.name === 'AbortError')) patchFile(key, { status: 'error', error: uploadError(err) })
        }
      )
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
      return { key, file, name, progress: 0, status: 'uploading', preview, abort: upload.abort }
    })
    setFiles((cur) => [...cur, ...added])
  }
  addFilesRef.current = addFiles

  function removeFile(key: string): void {
    const file = filesRef.current.find((f) => f.key === key)
    if (!file) return
    file.abort()
    if (file.preview) URL.revokeObjectURL(file.preview)
    setFiles((list) => list.filter((f) => f.key !== key))
  }

  // Leaving the conversation drops what wasn't sent (the server forgets it within a day).
  useEffect(
    () => () => {
      for (const f of filesRef.current) {
        f.abort()
        if (f.preview) URL.revokeObjectURL(f.preview)
      }
    },
    []
  )

  async function send(): Promise<void> {
    const content = value.trim()
    const pending = filesRef.current
    if (!content && !pending.length) return
    if (content.length > MAX_LENGTH) return setError(`Máximo de ${MAX_LENGTH} caracteres.`)
    if (pending.some((f) => f.status === 'uploading')) return setError('Espere os arquivos terminarem de subir.')
    if (pending.some((f) => f.status === 'error')) return setError('Remova os arquivos que falharam para enviar.')
    setValue('')
    setFiles([])
    setError(null)
    try {
      await sendMessage(
        channel.id,
        content,
        pending.map((f) => f.attachment!.id)
      )
      for (const f of pending) {
        seedAttachment(f.attachment!, f.file)
        if (f.preview) URL.revokeObjectURL(f.preview)
      }
    } catch (err) {
      setValue(content) // give everything back so nothing is lost
      setFiles(pending)
      setError(
        err instanceof ApiError && err.status === 403
          ? channel.server_id
            ? 'Você não tem permissão para enviar mensagens aqui.'
            : 'Só amigos podem conversar por mensagem direta.'
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

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>): void {
    const pasted = [...e.clipboardData.files]
    if (!pasted.length || !canAttach) return
    e.preventDefault()
    addFiles(pasted, pastedName)
  }

  return (
    <div className="shrink-0 px-4 pb-6">
      {error && <p className="mb-1 text-xs text-danger">{error}</p>}
      <PendingFiles files={files} onRemove={removeFile} />
      <div className="flex items-end gap-2">
        {canAttach && (
          <>
            <button
              type="button"
              title="Anexar arquivos"
              aria-label="Anexar arquivos"
              onClick={() => picker.current?.click()}
              className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elevated text-fg-muted hover:bg-accent hover:text-on-accent"
            >
              <Plus size={20} />
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                addFiles([...(e.target.files ?? [])])
                e.target.value = '' // picking the same file again still fires
              }}
            />
          </>
        )}
        <div className="min-w-0 flex-1">
          <AutoTextarea
            key={channel.id}
            autoFocus
            value={value}
            onChange={setValue}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={placeholder}
          />
        </div>
      </div>
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
  onPaste,
  placeholder,
  autoFocus
}: {
  value: string
  onChange(v: string): void
  onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void
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
      onPaste={onPaste}
      className="block w-full resize-none rounded-control border border-line bg-elevated px-4 py-2.5 leading-relaxed text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60"
    />
  )
}
