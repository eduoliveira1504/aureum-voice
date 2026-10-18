import { CalendarDays, ChevronLeft, ChevronRight, History, MoreHorizontal, Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'

import { Avatar, inputClass, MenuItem, menuClass, useDismiss } from '../../components/ui'
import { api, ApiError } from '../../lib/api'
import { memberName } from '../../lib/members'
import type { AddonViewProps } from '../types'
import { dueInfo, LabelChip } from './bits'
import { HistoryModal, LabelsModal } from './BoardModals'
import { CardModal } from './CardModal'
import {
  boardPath,
  columnCards,
  STAGE_LABEL,
  useKanban,
  type Board,
  type KanbanCard,
  type KanbanColumn,
  type Stage
} from './store'

/** Its own drag type, so the shell's panel drop zones ignore cards. */
const CARD_DRAG_TYPE = 'application/x-aureum-kanban-card'
const isCardDrag = (e: DragEvent): boolean => e.dataTransfer.types.includes(CARD_DRAG_TYPE)

interface Drop {
  columnId: string
  /** Index in the column as shown, the dragged card included. */
  index: number
}

export function KanbanPanel({ server, channel, me }: AddonViewProps): ReactNode {
  const board = useKanban((s) => s.boards[channel.id])
  const [error, setError] = useState<string | null>(null)
  const [openCard, setOpenCard] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'labels' | 'history' | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)

  useEffect(() => {
    void useKanban
      .getState()
      .load(channel.id)
      .catch(() => setError('Não foi possível abrir o quadro.'))
  }, [channel.id])

  const fail = useCallback((err: unknown): void => {
    setError(err instanceof ApiError && err.status === 403 ? 'Você não tem permissão para isso.' : 'Não foi possível salvar a mudança.')
  }, [])

  if (!board) {
    return (
      <div className="flex flex-1 items-center justify-center bg-main text-sm text-fg-subtle">
        {error ?? 'Carregando o quadro…'}
      </div>
    )
  }

  function dropCard(): void {
    const cardId = dragging
    setDragging(null)
    setDrop(null)
    if (!cardId || !drop || !board) return
    const card = board.cards.find((c) => c.id === cardId)
    if (!card) return
    // The API counts positions without the card itself.
    const shown = columnCards(board, drop.columnId)
    const from = shown.findIndex((c) => c.id === cardId)
    const position = from >= 0 && from < drop.index ? drop.index - 1 : drop.index
    if (card.column_id === drop.columnId && position === from) return
    setError(null)
    useKanban.getState().moveCard(channel.id, cardId, drop.columnId, position).catch(fail)
  }

  const card = openCard ? board.cards.find((c) => c.id === openCard) : undefined
  const counts = countByStage(board)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-main">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 text-sm">
        <span className="text-fg-muted">
          {counts.todo} a fazer · {counts.doing} fazendo · {counts.done} {counts.done === 1 ? 'feito' : 'feitos'}
        </span>
        {!board.can_edit && <span className="rounded-full bg-elevated px-2.5 py-0.5 text-xs text-fg-subtle">Somente leitura</span>}
        {error && (
          <span role="alert" className="text-danger">
            {error}
          </span>
        )}
        <div className="ml-auto flex gap-1">
          {board.can_manage && (
            <ToolbarButton icon={Tags} label="Etiquetas" onClick={() => setDialog('labels')} />
          )}
          <ToolbarButton icon={History} label="Histórico" onClick={() => setDialog('history')} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {board.columns.map((column, i) => (
          <ColumnView
            key={column.id}
            channelId={channel.id}
            board={board}
            column={column}
            index={i}
            people={server.members}
            meId={me.id}
            dragging={dragging}
            drop={drop?.columnId === column.id ? drop.index : null}
            onDragStart={setDragging}
            onDragOver={(index) => setDrop((d) => (d?.columnId === column.id && d.index === index ? d : { columnId: column.id, index }))}
            onDragEnd={() => {
              setDragging(null)
              setDrop(null)
            }}
            onDrop={dropCard}
            onOpen={setOpenCard}
            onError={fail}
          />
        ))}
        {board.can_manage && <NewColumn channelId={channel.id} onError={fail} />}
      </div>

      {card && <CardModal server={server} channel={channel} card={card} onClose={() => setOpenCard(null)} />}
      {dialog === 'labels' && <LabelsModal channelId={channel.id} onClose={() => setDialog(null)} />}
      {dialog === 'history' && <HistoryModal server={server} channelId={channel.id} onClose={() => setDialog(null)} />}
    </div>
  )
}

export function countByStage(board: Board): Record<Stage, number> {
  const stageOf = new Map(board.columns.map((c) => [c.id, c.stage]))
  const counts: Record<Stage, number> = { todo: 0, doing: 0, done: 0 }
  for (const card of board.cards) {
    const stage = stageOf.get(card.column_id)
    if (stage) counts[stage]++
  }
  return counts
}

function ToolbarButton({ icon: Icon, label, onClick }: { icon: typeof Tags; label: string; onClick(): void }): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-control px-2.5 py-1.5 font-medium text-fg-muted hover:bg-elevated hover:text-fg"
    >
      <Icon size={16} /> {label}
    </button>
  )
}

function ColumnView({
  channelId,
  board,
  column,
  index,
  people,
  meId,
  dragging,
  drop,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onOpen,
  onError
}: {
  channelId: string
  board: Board
  column: KanbanColumn
  index: number
  people: AddonViewProps['server']['members']
  meId: string
  dragging: string | null
  drop: number | null
  onDragStart(cardId: string): void
  onDragOver(index: number): void
  onDragEnd(): void
  onDrop(): void
  onOpen(cardId: string): void
  onError(err: unknown): void
}): ReactNode {
  const listRef = useRef<HTMLDivElement>(null)
  const cards = columnCards(board, column.id)

  // Where the pointer is among the cards: before the first card whose middle is below it.
  function pointerIndex(e: DragEvent): number {
    const tiles = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-card]') ?? [])]
    const i = tiles.findIndex((t) => {
      const r = t.getBoundingClientRect()
      return e.clientY < r.top + r.height / 2
    })
    return i < 0 ? tiles.length : i
  }

  return (
    <section
      aria-label={column.name}
      className="flex max-h-full w-72 shrink-0 flex-col rounded-panel border border-line bg-panel"
      onDragOver={(e) => {
        if (!isCardDrag(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOver(pointerIndex(e))
      }}
      onDrop={(e) => {
        if (!isCardDrag(e)) return
        e.preventDefault()
        onDrop()
      }}
    >
      <ColumnHeader channelId={channelId} board={board} column={column} index={index} count={cards.length} onError={onError} />
      <div ref={listRef} className="min-h-12 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {cards.map((card, i) => (
          <div key={card.id}>
            {drop === i && <DropMarker />}
            <CardTile
              card={card}
              board={board}
              people={people}
              meId={meId}
              faded={dragging === card.id}
              draggable={board.can_edit}
              onDragStart={(e) => {
                e.dataTransfer.setData(CARD_DRAG_TYPE, card.id)
                e.dataTransfer.effectAllowed = 'move'
                onDragStart(card.id)
              }}
              onDragEnd={onDragEnd}
              onOpen={() => onOpen(card.id)}
            />
          </div>
        ))}
        {drop === cards.length && <DropMarker />}
        {!cards.length && drop === null && <p className="px-1 py-2 text-xs text-fg-subtle">Nenhum card.</p>}
      </div>
      {board.can_edit && <NewCard channelId={channelId} columnId={column.id} onError={onError} />}
    </section>
  )
}

function DropMarker(): ReactNode {
  return <div className="mb-2 h-1 rounded-full bg-accent" />
}

function CardTile({
  card,
  board,
  people,
  meId,
  faded,
  draggable,
  onDragStart,
  onDragEnd,
  onOpen
}: {
  card: KanbanCard
  board: Board
  people: AddonViewProps['server']['members']
  meId: string
  faded: boolean
  draggable: boolean
  onDragStart(e: DragEvent): void
  onDragEnd(): void
  onOpen(): void
}): ReactNode {
  const labels = card.label_ids.map((id) => board.labels.find((l) => l.id === id)).filter((l) => l !== undefined)
  const assignee = card.assignee_id ? people.find((m) => m.user.id === card.assignee_id) : undefined
  const done = board.columns.find((c) => c.id === card.column_id)?.stage === 'done'
  const due = card.due_date ? dueInfo(card.due_date) : null
  return (
    <button
      type="button"
      data-card
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={`block w-full rounded-control border border-line bg-main p-3 text-left shadow-sm transition-opacity hover:border-accent/60 ${faded ? 'opacity-40' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      {labels.length > 0 && (
        <span className="mb-2 flex flex-wrap gap-1">
          {labels.map((label) => (
            <LabelChip key={label.id} label={label} small />
          ))}
        </span>
      )}
      <span className={`block break-words text-sm font-medium ${done ? 'text-fg-muted line-through decoration-fg-subtle' : 'text-fg'}`}>
        {card.title}
      </span>
      {(due || assignee) && (
        <span className="mt-2.5 flex items-center gap-2 text-xs">
          {due && (
            <span className={`flex items-center gap-1 ${due.late && !done ? 'font-semibold text-danger' : 'text-fg-subtle'}`}>
              <CalendarDays size={14} /> {due.text}
            </span>
          )}
          {assignee && (
            <span className="ml-auto flex min-w-0 items-center gap-1.5 text-fg-subtle" title={memberName(assignee)}>
              <span className="truncate">{assignee.user.id === meId ? 'Você' : memberName(assignee)}</span>
              <Avatar name={memberName(assignee)} url={assignee.user.avatar_url} size={20} />
            </span>
          )}
        </span>
      )}
    </button>
  )
}

function ColumnHeader({
  channelId,
  board,
  column,
  index,
  count,
  onError
}: {
  channelId: string
  board: Board
  column: KanbanColumn
  index: number
  count: number
  onError(err: unknown): void
}): ReactNode {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(column.name)
  const menuRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setMenu(false), [])
  useDismiss(menuRef, menu, close)

  const apply = useKanban.getState().apply
  async function patch(body: { name?: string; stage?: Stage }): Promise<void> {
    try {
      const updated = await api<KanbanColumn>(boardPath(channelId, `/columns/${column.id}`), { method: 'PATCH', body })
      apply('addon.kanban.column.updated', { ...updated, channel_id: channelId })
    } catch (err) {
      onError(err)
    }
  }
  async function move(position: number): Promise<void> {
    setMenu(false)
    try {
      const columns = await api<KanbanColumn[]>(boardPath(channelId, `/columns/${column.id}/move`), { method: 'POST', body: { position } })
      apply('addon.kanban.columns.moved', { columns, channel_id: channelId })
    } catch (err) {
      onError(err)
    }
  }
  async function remove(): Promise<void> {
    setMenu(false)
    try {
      await api(boardPath(channelId, `/columns/${column.id}`), { method: 'DELETE' })
      apply('addon.kanban.column.deleted', { id: column.id, channel_id: channelId })
    } catch (err) {
      onError(err)
    }
  }
  function rename(e: FormEvent): void {
    e.preventDefault()
    setRenaming(false)
    if (name.trim() && name.trim() !== column.name) void patch({ name: name.trim() })
    else setName(column.name)
  }

  return (
    <header className="flex items-center gap-2 px-3 pb-2 pt-3">
      {renaming ? (
        <form onSubmit={rename} className="flex-1">
          <input
            autoFocus
            aria-label="Nome da coluna"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setName(column.name)
                setRenaming(false)
              }
            }}
            className={`${inputClass} py-1.5 text-sm`}
          />
        </form>
      ) : (
        <h3 className="min-w-0 flex-1 truncate font-display text-sm font-semibold">{column.name}</h3>
      )}
      <span className="rounded-full bg-elevated px-2 py-0.5 text-xs font-semibold text-fg-muted">{count}</span>
      {board.can_manage && (
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label={`Opções da coluna ${column.name}`}
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
            className="rounded-item p-1 text-fg-subtle hover:bg-elevated hover:text-fg"
          >
            <MoreHorizontal size={16} />
          </button>
          {menu && (
            <div className={`${menuClass} absolute right-0 top-full mt-1 w-56`}>
              <MenuItem
                icon={Pencil}
                label="Renomear"
                onClick={() => {
                  setMenu(false)
                  setRenaming(true)
                }}
              />
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Conta no progresso como</p>
              {(Object.keys(STAGE_LABEL) as Stage[]).map((stage) => (
                <MenuItem
                  key={stage}
                  label={STAGE_LABEL[stage]}
                  hint={column.stage === stage ? 'atual' : undefined}
                  onClick={() => {
                    setMenu(false)
                    if (stage !== column.stage) void patch({ stage })
                  }}
                />
              ))}
              <div className="my-1 h-px bg-line" />
              <MenuItem icon={ChevronLeft} label="Mover para a esquerda" disabled={index === 0} onClick={() => void move(index - 1)} />
              <MenuItem
                icon={ChevronRight}
                label="Mover para a direita"
                disabled={index === board.columns.length - 1}
                onClick={() => void move(index + 1)}
              />
              <MenuItem
                icon={Trash2}
                label="Excluir coluna"
                hint={count ? 'tem cards' : undefined}
                danger
                disabled={count > 0 || board.columns.length <= 1}
                onClick={() => void remove()}
              />
            </div>
          )}
        </div>
      )}
    </header>
  )
}

function NewCard({ channelId, columnId, onError }: { channelId: string; columnId: string; onError(err: unknown): void }): ReactNode {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      await useKanban.getState().createCard(channelId, columnId, title.trim())
      setTitle('')
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="m-2 mt-0 flex items-center gap-1.5 rounded-control px-2 py-1.5 text-sm font-medium text-fg-muted hover:bg-elevated hover:text-fg"
      >
        <Plus size={16} /> Adicionar card
      </button>
    )
  }
  return (
    <form onSubmit={submit} className="p-2 pt-0">
      <input
        autoFocus
        aria-label="Título do card"
        placeholder="Título do card"
        maxLength={200}
        value={title}
        // Not disabled: that would drop the focus, and typing several cards in a row needs it.
        readOnly={busy}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setTitle('')
            setOpen(false)
          }
        }}
        className={`${inputClass} py-2 text-sm`}
      />
      <p className="mt-1 px-1 text-[11px] text-fg-subtle">Enter cria · Esc cancela</p>
    </form>
  )
}

function NewColumn({ channelId, onError }: { channelId: string; onError(err: unknown): void }): ReactNode {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!name.trim()) return
    try {
      const column = await api<KanbanColumn>(boardPath(channelId, '/columns'), { method: 'POST', body: { name: name.trim() } })
      useKanban.getState().apply('addon.kanban.column.created', { ...column, channel_id: channelId })
      setName('')
      setOpen(false)
    } catch (err) {
      onError(err)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-11 w-72 shrink-0 items-center gap-1.5 rounded-panel border border-dashed border-line px-3 text-sm font-medium text-fg-muted hover:bg-panel hover:text-fg"
      >
        <Plus size={16} /> Nova coluna
      </button>
    )
  }
  return (
    <form onSubmit={submit} className="w-72 shrink-0">
      <input
        autoFocus
        aria-label="Nome da coluna"
        placeholder="Nome da coluna"
        maxLength={60}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => !name.trim() && setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className={`${inputClass} text-sm`}
      />
    </form>
  )
}
