import { Plus, X } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'

import { FormError, Modal } from '../../components/Modal'
import { cn, inputClass, labelClass, PrimaryButton, ToggleRow } from '../../components/ui'
import { ApiError, type Channel } from '../../lib/api'
import { lastEmoji } from '../../lib/emoji'
import { DURATIONS, MAX_OPTIONS, MIN_OPTIONS, usePolls, type Duration } from './store'

interface OptionRow {
  key: number
  text: string
  emoji: string
}

let rowKeys = 0
const emptyRow = (): OptionRow => ({ key: ++rowKeys, text: '', emoji: '' })

/** "Criar enquete", from the "+" of the message box: posts the poll as a message here. */
export function CreatePollModal({ channel, onClose }: { channel: Channel; onClose(): void }): ReactNode {
  const [question, setQuestion] = useState('')
  const [rows, setRows] = useState<OptionRow[]>(() => [emptyRow(), emptyRow()])
  const [multiple, setMultiple] = useState(false)
  const [anonymous, setAnonymous] = useState(false)
  const [duration, setDuration] = useState<Duration | ''>('24h')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const patch = (key: number, change: Partial<OptionRow>): void => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...change } : r)))
  const filled = rows.filter((r) => r.text.trim())

  function check(): string | null {
    if (!question.trim()) return 'Escreva a pergunta.'
    if (filled.length < MIN_OPTIONS) return `Coloque pelo menos ${MIN_OPTIONS} opções.`
    const texts = filled.map((r) => r.text.trim().toLocaleLowerCase('pt-BR'))
    if (new Set(texts).size !== texts.length) return 'As opções precisam ser diferentes.'
    return null
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    const problem = check()
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      await usePolls.getState().create(channel.id, {
        question: question.trim(),
        options: filled.map((r) => ({ text: r.text.trim(), emoji: r.emoji.trim() || null })),
        multiple,
        anonymous,
        duration: duration || null
      })
      onClose()
    } catch (err) {
      setBusy(false)
      setError(
        err instanceof ApiError && err.status === 403
          ? channel.server_id
            ? 'Você não tem permissão para enviar mensagens aqui.'
            : 'Só amigos podem conversar por mensagem direta.'
          : 'Não foi possível criar a enquete.'
      )
    }
  }

  return (
    <Modal title="Criar enquete" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className={labelClass}>Pergunta</span>
          <input
            autoFocus
            value={question}
            maxLength={300}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="O que vocês acham?"
            className={inputClass}
          />
        </label>

        <div>
          <span className={labelClass}>Opções</span>
          <ul className="space-y-2">
            {rows.map((row, i) => (
              <li key={row.key} className="flex items-center gap-2">
                <input
                  value={row.text}
                  maxLength={80}
                  onChange={(e) => patch(row.key, { text: e.target.value })}
                  aria-label={`Opção ${i + 1}`}
                  placeholder={`Opção ${i + 1}`}
                  className={cn(inputClass, 'min-w-0 flex-1')}
                />
                {/* Only takes an emoji: text typed here would leave the option empty. */}
                <input
                  value={row.emoji}
                  onChange={(e) => patch(row.key, { emoji: lastEmoji(e.target.value) })}
                  aria-label={`Emoji da opção ${i + 1}`}
                  title="Emoji (opcional)"
                  placeholder="🙂"
                  className={cn(inputClass, 'w-11 shrink-0 px-0 text-center')}
                />
                <button
                  type="button"
                  aria-label={`Remover opção ${i + 1}`}
                  disabled={rows.length <= MIN_OPTIONS}
                  onClick={() => setRows((list) => list.filter((r) => r.key !== row.key))}
                  className="shrink-0 rounded-item p-1.5 text-fg-subtle hover:bg-elevated hover:text-danger disabled:invisible"
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
          {rows.length < MAX_OPTIONS && (
            <button
              type="button"
              onClick={() => setRows((list) => [...list, emptyRow()])}
              className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-accent-text hover:underline"
            >
              <Plus size={16} /> Adicionar opção
            </button>
          )}
        </div>

        <div className="space-y-2">
          <ToggleRow title="Várias respostas" description="Cada pessoa pode marcar mais de uma opção." checked={multiple} onChange={setMultiple} />
          <ToggleRow
            title="Votos anônimos"
            description="Todo mundo vê os totais, mas ninguém vê quem votou em quê. Não dá para mudar depois."
            checked={anonymous}
            onChange={setAnonymous}
          />
        </div>

        <label className="block">
          <span className={labelClass}>Prazo</span>
          <select value={duration} onChange={(e) => setDuration(e.target.value as Duration | '')} className={inputClass}>
            {DURATIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <FormError message={error} />
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? 'Criando…' : 'Criar enquete'}
        </PrimaryButton>
      </form>
    </Modal>
  )
}
