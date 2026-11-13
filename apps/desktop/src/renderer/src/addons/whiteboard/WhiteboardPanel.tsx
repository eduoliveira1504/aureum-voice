import { Archive, ArchiveRestore, ArrowLeft, ChevronDown, ChevronRight, Copy, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { ConfirmModal } from '../../components/modals'
import { inputClass, MenuItem, menuClass, useDismiss } from '../../components/ui'
import { api, ApiError, type User } from '../../lib/api'
import { serverPeople } from '../../lib/members'
import { has, Perm } from '../../lib/permissions'
import type { AddonViewProps } from '../types'
import { BoardThumbnail, editedLabel } from './bits'
import type { SyncStatus } from './BoardSync'
import { useWhiteboard, whiteboardPath, type BoardScene, type BoardSummary } from './store'
import { t } from '../../lib/i18n'

// Excalidraw is most of the addon's weight: loaded when a board opens.
const Editor = lazy(() => import('./Editor'))


const failure = (err: unknown): string =>
  err instanceof ApiError && err.status === 403 ? t('addons.whiteboard.panel.forbidden') : t('addons.whiteboard.panel.saveFailed')

/** Several boards per channel: the list, and the board open in place of it. */
export function WhiteboardPanel({ server, channel, me, perms, openItem, onItemOpened }: AddonViewProps): ReactNode {
  const list = useWhiteboard((s) => s.lists[channel.id])
  const people = useMemo(() => serverPeople(server), [server])
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setOpen(null)
    void useWhiteboard
      .getState()
      .load(channel.id)
      .catch(() => setError(t('addons.whiteboard.panel.loadFailed')))
  }, [channel.id])

  // A board picked outside (the overview's card).
  useEffect(() => {
    if (!openItem) return
    setOpen(openItem)
    onItemOpened?.()
  }, [openItem, onItemOpened])

  // The open board was deleted (here or by someone else): back to the list.
  const gone = !!open && !!list && !list.boards.some((b) => b.id === open)
  useEffect(() => {
    if (!gone) return
    setOpen(null)
    setError(t('addons.whiteboard.panel.deleted'))
  }, [gone])
  // Deleting is for whoever created the board, or who can manage addons; the others archive.
  const canDelete = (board: BoardSummary): boolean => board.created_by === me.id || has(perms, Perm.MANAGE_ADDONS)

  if (open && !gone) return <BoardView key={open} channelId={channel.id} boardId={open} people={people} onBack={() => setOpen(null)} />
  if (!list) {
    return <div className="flex flex-1 items-center justify-center bg-main text-sm text-fg-subtle">{error ?? t('addons.whiteboard.panel.loading')}</div>
  }
  return (
    <BoardList
      channelId={channel.id}
      boards={list.boards}
      canEdit={list.can_edit}
      people={people}
      error={error}
      onError={setError}
      onOpen={setOpen}
      canDelete={canDelete}
    />
  )
}

function BoardList({
  channelId,
  boards,
  canEdit,
  people,
  error,
  onError,
  onOpen,
  canDelete
}: {
  channelId: string
  boards: BoardSummary[]
  canEdit: boolean
  people: Map<string, User>
  error: string | null
  onError(message: string | null): void
  onOpen(boardId: string): void
  canDelete(board: BoardSummary): boolean
}): ReactNode {
  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const active = boards.filter((b) => !b.archived_at)
  const archived = boards.filter((b) => b.archived_at)

  async function create(name: string): Promise<void> {
    try {
      const board = await useWhiteboard.getState().create(channelId, name)
      setCreating(false)
      onOpen(board.id)
    } catch (err) {
      onError(failure(err))
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-main">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 text-sm">
        <span className="text-fg-muted">
          {active.length} {active.length === 1 ? 'quadro' : 'quadros'}
        </span>
        {!canEdit && <span className="rounded-full bg-elevated px-2.5 py-0.5 text-xs text-fg-subtle">{t('addons.whiteboard.panel.readOnly')}</span>}
        {error && (
          <span role="alert" className="text-danger">
            {error}
          </span>
        )}
        {canEdit && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="ml-auto flex items-center gap-1.5 rounded-control bg-accent px-3 py-1.5 font-semibold text-on-accent hover:bg-accent-hover"
          >
            <Plus size={16} /> {t('addons.whiteboard.panel.new')}
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {creating && <NameForm initial="" placeholder={t('addons.whiteboard.panel.name')} action={t('addons.whiteboard.panel.create')} onSubmit={create} onCancel={() => setCreating(false)} />}
        {!active.length && !creating && (
          <p className="py-10 text-center text-sm text-fg-subtle">
            {canEdit ? t('addons.whiteboard.panel.emptyEdit') : t('addons.whiteboard.panel.empty')}
          </p>
        )}
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {active.map((board) => (
            <BoardCard
              key={board.id}
              channelId={channelId}
              board={board}
              canEdit={canEdit}
              canDelete={canEdit && canDelete(board)}
              people={people}
              onOpen={onOpen}
              onError={onError}
            />
          ))}
        </ul>
        {!!archived.length && (
          <section className="mt-6">
            <button
              type="button"
              onClick={() => setShowArchived((s) => !s)}
              className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle hover:text-fg"
            >
              {showArchived ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {t('addons.whiteboard.panel.archived', { count: archived.length })}
            </button>
            {showArchived && (
              <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 opacity-80">
                {archived.map((board) => (
                  <BoardCard
              key={board.id}
              channelId={channelId}
              board={board}
              canEdit={canEdit}
              canDelete={canEdit && canDelete(board)}
              people={people}
              onOpen={onOpen}
              onError={onError}
            />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function BoardCard({
  channelId,
  board,
  canEdit,
  canDelete,
  people,
  onOpen,
  onError
}: {
  channelId: string
  board: BoardSummary
  canEdit: boolean
  canDelete: boolean
  people: Map<string, User>
  onOpen(boardId: string): void
  onError(message: string | null): void
}): ReactNode {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setMenu(false), [])
  useDismiss(ref, menu, close)
  const store = useWhiteboard.getState()

  function run(action: () => Promise<unknown>): void {
    setMenu(false)
    onError(null)
    action().catch((err: unknown) => onError(failure(err)))
  }

  if (renaming) {
    return (
      <li>
        <NameForm
          initial={board.name}
          placeholder={t('addons.whiteboard.panel.name')}
          action={t('common.save')}
          onSubmit={async (name) => {
            setRenaming(false)
            if (name !== board.name) run(() => store.update(channelId, board.id, { name }))
          }}
          onCancel={() => setRenaming(false)}
        />
      </li>
    )
  }

  return (
    <li className="group relative overflow-hidden rounded-panel border border-line bg-panel hover:border-accent">
      <button type="button" onClick={() => onOpen(board.id)} className="block w-full text-left">
        <BoardThumbnail channelId={channelId} board={board} className="aspect-[4/3] w-full border-b border-line" />
        <span className="block px-3 py-2">
          <span className="block truncate text-sm font-semibold">{board.name}</span>
          <span className="block truncate text-xs text-fg-subtle">{editedLabel(board, people)}</span>
        </span>
      </button>
      {canEdit && (
        <div ref={ref} className="absolute right-2 top-2">
          <button
            type="button"
            aria-label={t('addons.whiteboard.panel.options')}
            onClick={() => setMenu((m) => !m)}
            className="rounded-item bg-panel/90 p-1 text-fg-muted opacity-0 shadow hover:text-fg focus:opacity-100 group-hover:opacity-100"
          >
            <MoreHorizontal size={16} />
          </button>
          {menu && (
            <div className={`${menuClass} absolute right-0 top-full mt-1 w-48`}>
              <MenuItem
                icon={Pencil}
                label={t('addons.whiteboard.panel.rename')}
                onClick={() => {
                  setMenu(false)
                  setRenaming(true)
                }}
              />
              <MenuItem icon={Copy} label={t('addons.whiteboard.panel.duplicate')} onClick={() => run(() => store.duplicate(channelId, board.id))} />
              {board.archived_at ? (
                <MenuItem icon={ArchiveRestore} label={t('addons.whiteboard.panel.unarchive')} onClick={() => run(() => store.update(channelId, board.id, { archived: false }))} />
              ) : (
                <MenuItem icon={Archive} label={t('addons.whiteboard.panel.archive')} onClick={() => run(() => store.update(channelId, board.id, { archived: true }))} />
              )}
              {canDelete && (
                <MenuItem
                  icon={Trash2}
                  label={t('addons.whiteboard.panel.delete')}
                  danger
                  onClick={() => {
                    setMenu(false)
                    setDeleting(true)
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}
      {deleting && (
        <ConfirmModal
          title={t('addons.whiteboard.panel.deleteTitle')}
          message={t('addons.whiteboard.panel.deleteConfirm', { name: board.name })}
          confirmLabel={t('addons.whiteboard.panel.delete')}
          onConfirm={() => store.remove(channelId, board.id)}
          onClose={() => setDeleting(false)}
        />
      )}
    </li>
  )
}

function NameForm({
  initial,
  placeholder,
  action,
  onSubmit,
  onCancel
}: {
  initial: string
  placeholder: string
  action: string
  onSubmit(name: string): Promise<void>
  onCancel(): void
}): ReactNode {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    await onSubmit(name.trim())
    setBusy(false)
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="mb-3 flex max-w-md gap-2">
      <input
        autoFocus
        value={name}
        maxLength={80}
        placeholder={placeholder}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        className={inputClass}
      />
      <button type="submit" disabled={!name.trim() || busy} className="rounded-control bg-accent px-3 text-sm font-semibold text-on-accent disabled:opacity-60">
        {action}
      </button>
      <button type="button" onClick={onCancel} className="rounded-control px-2 text-sm text-fg-muted hover:bg-elevated">
        {t('common.cancel')}
      </button>
    </form>
  )
}

/** One board open: a bar on top (back, name, save state) and the editor. */
function BoardView({
  channelId,
  boardId,
  people,
  onBack
}: {
  channelId: string
  boardId: string
  people: Map<string, User>
  onBack(): void
}): ReactNode {
  const summary = useWhiteboard((s) => s.lists[channelId]?.boards.find((b) => b.id === boardId))
  const [board, setBoard] = useState<BoardScene | null>(null)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<BoardScene>(whiteboardPath(channelId, `/boards/${boardId}`))
      .then(setBoard)
      .catch(() => setError(t('addons.whiteboard.panel.openFailed')))
  }, [channelId, boardId])

  const problem = status === 'offline' || status === 'full' || status === 'image-failed'
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-main">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2 text-sm">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-control px-2 py-1 font-medium text-fg-muted hover:bg-elevated hover:text-fg"
        >
          <ArrowLeft size={16} /> {t('addons.whiteboard.panel.boards')}
        </button>
        <span className="min-w-0 truncate font-semibold">{summary?.name ?? board?.name}</span>
        {board && !board.can_edit && <span className="rounded-full bg-elevated px-2.5 py-0.5 text-xs text-fg-subtle">{t('addons.whiteboard.panel.readOnly')}</span>}
        {summary?.archived_at && <span className="rounded-full bg-elevated px-2.5 py-0.5 text-xs text-fg-subtle">{t('addons.whiteboard.panel.archivedTag')}</span>}
        <span role={problem ? 'alert' : undefined} className={`ml-auto shrink-0 text-xs ${problem ? 'text-danger' : 'text-fg-subtle'}`}>
          {error ?? (status && t(`addons.whiteboard.status.${status}`))}
        </span>
      </header>
      {board ? (
        <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-fg-subtle">{t('addons.whiteboard.panel.opening')}</div>}>
          <Editor channelId={channelId} board={board} people={people} onStatus={setStatus} onError={setError} />
        </Suspense>
      ) : (
        !error && <div className="flex flex-1 items-center justify-center text-sm text-fg-subtle">{t('addons.whiteboard.panel.opening')}</div>
      )}
    </div>
  )
}
