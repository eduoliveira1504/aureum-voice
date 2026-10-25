import { Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { ConfirmModal } from '../../components/modals'
import { FormError, Modal, SecondaryButton } from '../../components/Modal'
import { cn, inputClass, labelClass, PrimaryButton } from '../../components/ui'
import { ApiError, type Channel, type ServerDetail } from '../../lib/api'
import { memberName } from '../../lib/members'
import { boardMembers, labelStyle } from './bits'
import { HistoryList } from './BoardModals'
import { columnCards, useKanban, type CardFields, type KanbanCard } from './store'

function errorText(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) return 'Você não pode mexer neste quadro.'
  if (err instanceof ApiError && err.status === 404) return 'Este card foi excluído.'
  return 'Não foi possível salvar o card.'
}

/** A card's details: everything about it, editable for who can edit the board, plus its history. */
export function CardModal({
  server,
  channel,
  card,
  onClose
}: {
  server: ServerDetail
  channel: Channel
  card: KanbanCard
  onClose(): void
}): ReactNode {
  const board = useKanban((s) => s.boards[channel.id])!
  const editable = board.can_edit
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description)
  const [assignee, setAssignee] = useState(card.assignee_id ?? '')
  const [labels, setLabels] = useState(card.label_ids)
  const [due, setDue] = useState(card.due_date ?? '')
  const [column, setColumn] = useState(card.column_id)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const members = boardMembers(server, channel)

  const fields: CardFields = {}
  if (title.trim() !== card.title) fields.title = title.trim()
  if (description !== card.description) fields.description = description
  if ((assignee || null) !== card.assignee_id) fields.assignee_id = assignee || null
  if (labels.join() !== card.label_ids.join()) fields.label_ids = labels
  if ((due || null) !== card.due_date) fields.due_date = due || null
  const dirty = Object.keys(fields).length > 0 || column !== card.column_id

  async function save(): Promise<void> {
    if (!title.trim()) return setError('Dê um título ao card.')
    setBusy(true)
    setError(null)
    const store = useKanban.getState()
    try {
      if (Object.keys(fields).length) await store.updateCard(channel.id, card.id, fields)
      // Picking another column puts the card at its end.
      if (column !== card.column_id) await store.moveCard(channel.id, card.id, column, columnCards(board, column).length)
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleLabel = (id: string): void => setLabels((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))

  return (
    <Modal title={editable ? 'Card' : card.title} wide onClose={onClose}>
      <div className="grid max-h-[65vh] gap-6 overflow-y-auto pr-1 md:grid-cols-[1fr_220px]">
        <div className="min-w-0 space-y-4">
          <FormError message={error} />
          {editable && (
            <label className="block">
              <span className={labelClass}>Título</span>
              <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
            </label>
          )}
          <label className="block">
            <span className={labelClass}>Descrição</span>
            {editable ? (
              <textarea
                value={description}
                maxLength={5000}
                rows={6}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detalhes, links, o que falta…"
                className={cn(inputClass, 'resize-y')}
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-fg-muted">{card.description || 'Sem descrição.'}</p>
            )}
          </label>
          <section>
            <h3 className={labelClass}>Histórico</h3>
            <HistoryList server={server} channelId={channel.id} cardId={card.id} />
          </section>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className={labelClass}>Coluna</span>
            <select value={column} disabled={!editable} onChange={(e) => setColumn(e.target.value)} className={inputClass}>
              {board.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Responsável</span>
            <select value={assignee} disabled={!editable} onChange={(e) => setAssignee(e.target.value)} className={inputClass}>
              <option value="">Ninguém</option>
              {members.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {memberName(m)}
                </option>
              ))}
              {/* Someone who can't see the board anymore still shows as they are. */}
              {card.assignee_id && !members.some((m) => m.user.id === card.assignee_id) && (
                <option value={card.assignee_id}>Sem acesso ao quadro</option>
              )}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Prazo</span>
            <input type="date" value={due} disabled={!editable} onChange={(e) => setDue(e.target.value)} className={inputClass} />
          </label>
          <div>
            <span className={labelClass}>Etiquetas</span>
            {board.labels.length ? (
              <div className="flex flex-wrap gap-1.5">
                {board.labels.map((label) => {
                  const on = labels.includes(label.id)
                  return (
                    <button
                      key={label.id}
                      type="button"
                      aria-pressed={on}
                      disabled={!editable || (!on && labels.length >= 10)}
                      onClick={() => toggleLabel(label.id)}
                      style={on ? labelStyle(label.color) : undefined}
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold disabled:cursor-default ${on ? 'border-transparent' : 'border-line text-fg-subtle hover:text-fg'}`}
                    >
                      {label.name}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-fg-subtle">
                {board.can_manage ? 'Crie etiquetas em “Etiquetas”, no topo do quadro.' : 'O quadro ainda não tem etiquetas.'}
              </p>
            )}
          </div>
        </div>
      </div>

      {editable && (
        <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => setDeleting(true)}
            className="flex items-center gap-1.5 rounded-control px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10"
          >
            <Trash2 size={16} /> Excluir
          </button>
          <div className="ml-auto w-32">
            <SecondaryButton type="button" onClick={onClose}>
              Cancelar
            </SecondaryButton>
          </div>
          <div className="w-32">
            <PrimaryButton type="button" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? 'Salvando…' : 'Salvar'}
            </PrimaryButton>
          </div>
        </div>
      )}

      {deleting && (
        <ConfirmModal
          title="Excluir card"
          message={`Excluir “${card.title}”? Isso não pode ser desfeito.`}
          confirmLabel="Excluir"
          onConfirm={async () => {
            await useKanban.getState().deleteCard(channel.id, card.id)
            onClose()
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </Modal>
  )
}
