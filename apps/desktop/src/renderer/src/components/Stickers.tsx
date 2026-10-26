import { ImageOff, Lock, Pencil, Plus, Search, Smile, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { api, ApiError, uploadFile, type Attachment, type ServerDetail, type Sticker, type StickerPack } from '../lib/api'
import { useAttachmentUrl } from '../lib/attachments'
import { useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { stickerMatches, usableIn, useStickers } from '../store/stickers'
import { pickEmoji, Emoji } from './Emoji'
import { ConfirmModal } from './modals'
import { FormError } from './Modal'
import { cn, inputClass, labelClass, PrimaryButton } from './ui'

/** Stickers come with the token, like attachments (same memory and disk cache: ids are UUIDs). */
function useStickerUrl(sticker: { id: string; url: string }): { url: string | null; failed: boolean } {
  return useAttachmentUrl({ id: sticker.id, url: sticker.url, content_type: 'image/webp' } as Attachment)
}

/** A sticker's image at `size` px; a "removed" mark when it's gone. */
export function StickerImage({ sticker, size, className = '' }: { sticker: { id: string; url: string; name: string }; size: number; className?: string }): ReactNode {
  const { url, failed } = useStickerUrl(sticker)
  const box = { width: size, height: size }
  if (failed) {
    return (
      <span style={box} title="Figurinha removida" className={cn('flex flex-col items-center justify-center gap-1 rounded-control border border-dashed border-line text-xs text-fg-subtle', className)}>
        <ImageOff size={size > 80 ? 22 : 16} />
        {size > 80 && 'Figurinha removida'}
      </span>
    )
  }
  return url ? (
    <img src={url} alt={sticker.name} title={sticker.name} draggable={false} style={box} className={cn('object-contain', className)} />
  ) : (
    <span style={box} className={cn('block animate-pulse rounded-control bg-elevated', className)} />
  )
}

/** A sticker message: the sticker on its own, 160 px, no bubble. */
export function StickerMessage({ sticker }: { sticker: { id: string; url: string; name: string } }): ReactNode {
  return <StickerImage sticker={sticker} size={160} className="my-0.5" />
}

// --- Picker tab ------------------------------------------------------------------------------

/** The "Figurinhas" tab of the picker: recent ones, Aureum's packs, this server's, and the user's
 * other servers' locked (they only go in their own server). */
export function StickerPanel({ serverId, onPick }: { serverId: string | null; onPick(sticker: Sticker): void }): ReactNode {
  const packs = useStickers((s) => s.packs)
  const loaded = useStickers((s) => s.loaded)
  const recentIds = useAppearance((s) => s.settings.recent_stickers)
  const servers = useChat((s) => s.servers)
  const [query, setQuery] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    useStickers.getState().load().catch(() => setFailed(true))
  }, [])

  const usable = packs.filter((p) => usableIn(p, serverId))
  const byId = new Map(usable.flatMap((p) => p.stickers.map((s) => [s.id, s] as const)))
  const recent = recentIds.map((id) => byId.get(id)).filter((s): s is Sticker => !!s).slice(0, 8)
  // This server first among the servers', then the others (locked).
  const ordered = [
    ...packs.filter((p) => p.is_global),
    ...packs.filter((p) => !p.is_global && p.server_id === serverId),
    ...packs.filter((p) => !p.is_global && p.server_id !== serverId)
  ]
  const title = (pack: StickerPack): string => (pack.is_global ? pack.name : (servers[pack.server_id ?? '']?.name ?? 'Servidor'))

  const cell = (sticker: Sticker, locked: string | null): ReactNode => (
    <button
      key={sticker.id}
      type="button"
      disabled={!!locked}
      onClick={() => onPick(sticker)}
      title={locked ?? sticker.name}
      aria-label={locked ? `${sticker.name} (${locked})` : sticker.name}
      className="relative flex items-center justify-center rounded-item p-1 hover:bg-elevated focus-visible:bg-elevated disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      <StickerImage sticker={sticker} size={68} className={locked ? 'opacity-35 grayscale' : ''} />
      {locked && <Lock size={14} className="absolute bottom-1.5 right-1.5 text-fg-muted" />}
    </button>
  )

  return (
    <>
      <div className="border-b border-line p-2">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar figurinha"
            aria-label="Buscar figurinha"
            className={cn(inputClass, 'py-1.5 pl-8 text-sm')}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!loaded ? (
          <p className="py-8 text-center text-sm text-fg-subtle">{failed ? 'Não foi possível carregar as figurinhas.' : 'Carregando…'}</p>
        ) : (
          <>
            {!query.trim() && recent.length > 0 && (
              <section>
                <h3 className="sticky top-0 z-10 bg-main pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Recentes</h3>
                <div className="grid grid-cols-4">{recent.map((s) => cell(s, null))}</div>
              </section>
            )}
            {ordered.map((pack) => {
              const shown = pack.stickers.filter((s) => stickerMatches(s, query))
              if (!shown.length) return null
              const locked = usableIn(pack, serverId) ? null : `Só no servidor ${title(pack)}`
              return (
                <section key={pack.id}>
                  <h3 className="sticky top-0 z-10 flex items-center gap-1 bg-main pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                    {locked && <Lock size={11} />}
                    {title(pack)}
                  </h3>
                  <div className="grid grid-cols-4">{shown.map((s) => cell(s, locked))}</div>
                </section>
              )
            })}
            {packs.every((p) => !p.stickers.some((s) => stickerMatches(s, query))) && (
              <p className="py-8 text-center text-sm text-fg-subtle">{query.trim() ? 'Nenhuma figurinha encontrada.' : 'Nenhuma figurinha ainda.'}</p>
            )}
          </>
        )}
      </div>
    </>
  )
}

// --- Server settings › Figurinhas ------------------------------------------------------------

const MAX_PER_SERVER = 30
const MAX_BYTES = 512 * 1024

function stickerError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 413) return 'A figurinha pode ter até 512 KB.'
    if (err.status === 415) return 'Use PNG ou WebP sem animação.'
    if (err.status === 409) return `Até ${MAX_PER_SERVER} figurinhas por servidor.`
    if (err.status === 403) return 'Você não tem permissão para isso.'
    if (err.status === 422) return 'O nome precisa de 2 a 30 letras; o emoji, um só.'
  }
  return 'Algo deu errado. Tente de novo.'
}

/** Send, rename and remove the server's own stickers (MANAGE_EXPRESSIONS). */
export function ServerStickersTab({ server }: { server: ServerDetail }): ReactNode {
  const pack = useStickers((s) => s.packs.find((p) => p.server_id === server.id))
  const stickers = pack?.stickers ?? []
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [removing, setRemoving] = useState<Sticker | null>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  useEffect(() => {
    void useStickers.getState().load().catch(() => {})
  }, [])

  const reload = (): Promise<void> => useStickers.getState().load()

  async function add(): Promise<void> {
    if (!file || name.trim().length < 2) return
    if (file.size > MAX_BYTES) return setError('A figurinha pode ter até 512 KB.')
    setBusy(true)
    setError(null)
    try {
      await uploadFile(`/servers/${server.id}/stickers`, file, file.name, () => {}, { name: name.trim(), ...(emoji && { emoji }) }).done
      setName('')
      setEmoji(null)
      setFile(null)
      await reload()
    } catch (err) {
      setError(stickerError(err))
    } finally {
      setBusy(false)
    }
  }

  async function change(sticker: Sticker, body: { name?: string; emoji?: string }): Promise<void> {
    setError(null)
    try {
      await api(`/stickers/${sticker.id}`, { method: 'PATCH', body })
      await reload()
    } catch (err) {
      setError(stickerError(err))
    }
  }

  return (
    <div className="max-w-[560px] space-y-5">
      <FormError message={error} />
      <div className="space-y-2">
        <span className={labelClass}>Nova figurinha</span>
        <div className="flex items-end gap-3">
          <button
            type="button"
            onClick={() => filePicker.current?.click()}
            aria-label="Escolher imagem"
            className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-control border border-dashed border-line bg-main text-fg-subtle hover:text-fg"
          >
            {preview ? <img src={preview} alt="" className="h-full w-full object-contain" /> : <Plus size={22} />}
          </button>
          <input
            ref={filePicker}
            type="file"
            accept="image/png,image/webp"
            hidden
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
                placeholder="Nome (ex: kkkk)"
                aria-label="Nome da figurinha"
                className={cn(inputClass, 'flex-1')}
              />
              <button
                type="button"
                title="Emoji relacionado (para a busca)"
                aria-label="Emoji relacionado"
                onClick={(e) => pickEmoji(e.currentTarget, setEmoji)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setEmoji(null)
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-line bg-main text-fg-subtle hover:text-fg"
              >
                {emoji ? <Emoji emoji={emoji} size={22} /> : <Smile size={18} />}
              </button>
            </div>
            <PrimaryButton type="button" disabled={busy || !file || name.trim().length < 2 || stickers.length >= MAX_PER_SERVER} onClick={() => void add()}>
              {busy ? 'Enviando…' : 'Adicionar'}
            </PrimaryButton>
          </div>
        </div>
        <p className="text-xs text-fg-subtle">
          PNG ou WebP sem animação, até 512 KB. Imagens maiores que 320×320 são reduzidas. {stickers.length}/{MAX_PER_SERVER} usadas.
          Só podem ser enviadas neste servidor.
        </p>
      </div>

      {stickers.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {stickers.map((sticker) => (
            <ServerStickerItem key={sticker.id} sticker={sticker} onChange={(body) => change(sticker, body)} onRemove={() => setRemoving(sticker)} />
          ))}
        </ul>
      )}

      {removing && (
        <ConfirmModal
          title="Remover figurinha"
          message={`Remover "${removing.name}"? As mensagens que já usaram mostram que ela foi removida.`}
          confirmLabel="Remover"
          onConfirm={async () => {
            await api(`/stickers/${removing.id}`, { method: 'DELETE' })
            await reload()
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}

function ServerStickerItem({
  sticker,
  onChange,
  onRemove
}: {
  sticker: Sticker
  onChange(body: { name?: string; emoji?: string }): Promise<void>
  onRemove(): void
}): ReactNode {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(sticker.name)
  return (
    <li className="flex flex-col items-center gap-1.5 rounded-control border border-line bg-main p-2">
      <StickerImage sticker={sticker} size={96} />
      {editing ? (
        <form
          className="w-full"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim().length >= 2) void onChange({ name: name.trim() }).then(() => setEditing(false))
          }}
        >
          <input autoFocus value={name} maxLength={30} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(false)}
            aria-label="Novo nome" className={cn(inputClass, 'py-1 text-sm')} />
        </form>
      ) : (
        <p className="flex w-full items-center justify-center gap-1 truncate text-sm">
          {sticker.emoji && <Emoji emoji={sticker.emoji} size={16} />}
          <span className="truncate">{sticker.name}</span>
        </p>
      )}
      <div className="flex gap-1 text-fg-subtle">
        <button type="button" title="Renomear" aria-label={`Renomear ${sticker.name}`} onClick={() => setEditing(true)} className="rounded-item p-1.5 hover:bg-elevated hover:text-fg">
          <Pencil size={14} />
        </button>
        <button
          type="button"
          title="Trocar emoji"
          aria-label={`Trocar emoji de ${sticker.name}`}
          onClick={(e) => pickEmoji(e.currentTarget, (emoji) => void onChange({ emoji }))}
          className="rounded-item p-1.5 hover:bg-elevated hover:text-fg"
        >
          <Smile size={14} />
        </button>
        <button type="button" title="Remover" aria-label={`Remover ${sticker.name}`} onClick={onRemove} className="rounded-item p-1.5 hover:bg-elevated hover:text-danger">
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  )
}
