import { Plus, SmilePlus, X } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'

import { Emoji, pickEmoji } from '../../components/Emoji'
import { FormError, Modal } from '../../components/Modal'
import { cn, inputClass, labelClass, PrimaryButton, ToggleRow } from '../../components/ui'
import { ApiError, type Channel } from '../../lib/api'
import { DURATIONS, MAX_OPTIONS, MIN_OPTIONS, usePolls, type Duration } from './store'
import { t } from '../../lib/i18n'

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
    if (!question.trim()) return t('addons.polls.askQuestion')
    if (filled.length < MIN_OPTIONS) return t('addons.polls.minOptions', { count: MIN_OPTIONS })
    const texts = filled.map((r) => r.text.trim().toLocaleLowerCase('pt-BR'))
    if (new Set(texts).size !== texts.length) return t('addons.polls.distinct')
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
            ? t('chat.noSendHere')
            : t('chat.friendsOnly')
          : t('addons.polls.createFailed')
      )
    }
  }

  return (
    <Modal title={t('addons.polls.create')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className={labelClass}>{t('addons.polls.question')}</span>
          <input
            autoFocus
            value={question}
            maxLength={300}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t('addons.polls.questionPlaceholder')}
            className={inputClass}
          />
        </label>

        <div>
          <span className={labelClass}>{t('addons.polls.options')}</span>
          <ul className="space-y-2">
            {rows.map((row, i) => (
              <li key={row.key} className="flex items-center gap-2">
                <input
                  value={row.text}
                  maxLength={80}
                  onChange={(e) => patch(row.key, { text: e.target.value })}
                  aria-label={t('addons.polls.option', { n: i + 1 })}
                  placeholder={t('addons.polls.option', { n: i + 1 })}
                  className={cn(inputClass, 'min-w-0 flex-1')}
                />
                {/* Opens the emoji picker: no text can end up here instead of in the option. */}
                <button
                  type="button"
                  aria-label={row.emoji ? t('addons.polls.optionEmoji', { n: i + 1, emoji: row.emoji }) : t('addons.polls.pickOptionEmoji', { n: i + 1 })}
                  title={row.emoji ? t('addons.polls.changeEmoji') : t('addons.polls.emojiOptional')}
                  onClick={(e) => pickEmoji(e.currentTarget, (emoji) => patch(row.key, { emoji }))}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    patch(row.key, { emoji: '' })
                  }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-line bg-main text-fg-subtle hover:border-accent hover:text-fg"
                >
                  {row.emoji ? <Emoji emoji={row.emoji} size={22} /> : <SmilePlus size={18} />}
                </button>
                <button
                  type="button"
                  aria-label={t('addons.polls.removeOption', { n: i + 1 })}
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
              <Plus size={16} /> {t('addons.polls.addOption')}
            </button>
          )}
        </div>

        <div className="space-y-2">
          <ToggleRow title={t('addons.polls.multiple')} description={t('addons.polls.multipleHint')} checked={multiple} onChange={setMultiple} />
          <ToggleRow
            title={t('addons.polls.anonymous')}
            description={t('addons.polls.anonymousHint')}
            checked={anonymous}
            onChange={setAnonymous}
          />
        </div>

        <label className="block">
          <span className={labelClass}>{t('addons.polls.deadline')}</span>
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
          {busy ? t('addons.polls.creating') : t('addons.polls.create')}
        </PrimaryButton>
      </form>
    </Modal>
  )
}
