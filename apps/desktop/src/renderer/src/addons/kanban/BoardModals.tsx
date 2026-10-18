import { Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { FormError, Modal } from '../../components/Modal'
import { Avatar, inputClass } from '../../components/ui'
import { api, type ServerDetail } from '../../lib/api'
import { memberName } from '../../lib/members'
import { describe, formatWhen, LABEL_COLOR_NAME, LabelChip } from './bits'
import { boardPath, LABEL_COLORS, useKanban, type HistoryEntry, type KanbanLabel, type LabelColor } from './store'

const PAGE = 50

/** The board's history, or one card's: newest first, with "Ver mais". */
export function HistoryList({ server, channelId, cardId }: { server: ServerDetail; channelId: string; cardId?: string }): ReactNode {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState(false)
  // Refetch when the card changes (an edit adds an entry).
  const updatedAt = useKanban((s) => (cardId ? s.boards[channelId]?.cards.find((c) => c.id === cardId)?.updated_at : undefined))

  async function load(before?: number): Promise<void> {
    const params = new URLSearchParams({ limit: String(PAGE) })
    if (cardId) params.set('card_id', cardId)
    if (before) params.set('before', String(before))
    try {
      const page = await api<HistoryEntry[]>(boardPath(channelId, `/history?${params}`))
      setEntries((prev) => (before && prev ? [...prev, ...page] : page))
      setMore(page.length === PAGE)
    } catch {
      setError(true)
    }
  }

  useEffect(() => {
    void load()
  }, [channelId, cardId, updatedAt])

  if (error) return <p className="text-sm text-danger">Não foi possível carregar o histórico.</p>
  if (!entries) return <p className="text-sm text-fg-subtle">Carregando…</p>
  if (!entries.length) return <p className="text-sm text-fg-subtle">Nada por aqui ainda.</p>
  const people = new Map(server.members.map((m) => [m.user.id, m]))
  return (
    <ol className="space-y-2.5">
      {entries.map((entry) => {
        const actor = entry.actor_id ? people.get(entry.actor_id) : undefined
        const name = actor ? memberName(actor) : 'Alguém'
        return (
          <li key={entry.id} className="flex items-start gap-2.5 text-sm">
            <Avatar name={name} url={actor?.user.avatar_url} size={24} />
            <span className="min-w-0 flex-1 text-fg-muted">
              <span className="font-semibold text-fg">{name}</span> {describe(entry)}
              <span className="ml-2 text-xs text-fg-subtle">{formatWhen(entry.created_at)}</span>
            </span>
          </li>
        )
      })}
      {more && (
        <li>
          <button type="button" onClick={() => void load(entries[entries.length - 1].id)} className="text-sm font-semibold text-accent-text hover:underline">
            Ver mais
          </button>
        </li>
      )}
    </ol>
  )
}

export function HistoryModal({ server, channelId, onClose }: { server: ServerDetail; channelId: string; onClose(): void }): ReactNode {
  return (
    <Modal title="Histórico do quadro" onClose={onClose}>
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        <HistoryList server={server} channelId={channelId} />
      </div>
    </Modal>
  )
}

function ColorPicker({ value, onChange }: { value: LabelColor; onChange(color: LabelColor): void }): ReactNode {
  return (
    <div role="radiogroup" aria-label="Cor" className="flex flex-wrap gap-1.5">
      {LABEL_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={LABEL_COLOR_NAME[color]}
          title={LABEL_COLOR_NAME[color]}
          onClick={() => onChange(color)}
          style={{ background: `var(--label-${color})` }}
          className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-panel ${value === color ? 'ring-2 ring-fg' : ''}`}
        />
      ))}
    </div>
  )
}

/** Creating, recoloring and deleting the board's labels (who can manage the addon). */
export function LabelsModal({ channelId, onClose }: { channelId: string; onClose(): void }): ReactNode {
  const labels = useKanban((s) => s.boards[channelId]?.labels ?? [])
  const [name, setName] = useState('')
  const [color, setColor] = useState<LabelColor>('blue')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch {
      setError('Não foi possível salvar a etiqueta.')
    } finally {
      setBusy(false)
    }
  }

  const apply = (label: KanbanLabel): void =>
    useKanban.getState().apply('addon.kanban.label.updated', { ...label, channel_id: channelId })

  function create(e: FormEvent): void {
    e.preventDefault()
    if (!name.trim()) return
    void run(async () => {
      const label = await api<KanbanLabel>(boardPath(channelId, '/labels'), { method: 'POST', body: { name: name.trim(), color } })
      apply(label)
      setName('')
    })
  }

  return (
    <Modal title="Etiquetas" onClose={onClose}>
      <div className="space-y-4">
        <FormError message={error} />
        <ul className="space-y-2">
          {labels.map((label) => (
            <li key={label.id} className="flex items-center gap-3 rounded-control border border-line bg-main px-3 py-2">
              <div className="min-w-0 flex-1 space-y-2">
                <LabelChip label={label} />
                <ColorPicker
                  value={label.color}
                  onChange={(c) =>
                    void run(async () =>
                      apply(await api<KanbanLabel>(boardPath(channelId, `/labels/${label.id}`), { method: 'PATCH', body: { color: c } }))
                    )
                  }
                />
              </div>
              <button
                type="button"
                aria-label={`Excluir ${label.name}`}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(boardPath(channelId, `/labels/${label.id}`), { method: 'DELETE' })
                    useKanban.getState().apply('addon.kanban.label.deleted', { id: label.id, channel_id: channelId })
                  })
                }
                className="rounded-item p-1.5 text-fg-subtle hover:bg-elevated hover:text-danger"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
          {!labels.length && <li className="text-sm text-fg-subtle">Nenhuma etiqueta ainda.</li>}
        </ul>
        <form onSubmit={create} className="space-y-2.5 rounded-control border border-dashed border-line p-3">
          <div className="flex items-center gap-2">
            <input
              aria-label="Nome da etiqueta"
              placeholder="Nova etiqueta"
              maxLength={30}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="shrink-0 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
            >
              Criar
            </button>
          </div>
          <ColorPicker value={color} onChange={setColor} />
          {name.trim() && <LabelChip label={{ id: '', name: name.trim(), color }} />}
        </form>
      </div>
    </Modal>
  )
}
