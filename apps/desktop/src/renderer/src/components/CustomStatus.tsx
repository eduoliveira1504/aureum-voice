import { X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { api, type CustomStatus, type Me } from '../lib/api'
import { FormError, Modal } from './Modal'
import { errorText } from './modals'
import { inputClass, labelClass, PrimaryButton } from './ui'

const EMOJIS = ['😀', '😎', '🥱', '😴', '🤒', '🎮', '🎧', '📚', '💻', '🍕', '☕', '🏃', '✈️', '🎬', '🔥', '❤️', '🛠️', '🎉', '🤫', '👀']

export type Duration = 'keep' | '30m' | '1h' | '4h' | 'today' | 'never'

const DURATIONS: { value: Duration; label: string }[] = [
  { value: '30m', label: '30 minutos' },
  { value: '1h', label: '1 hora' },
  { value: '4h', label: '4 horas' },
  { value: 'today', label: 'Hoje' },
  { value: 'never', label: 'Não limpar' }
]

const expiryFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })

export interface StatusDraft {
  emoji: string | null
  text: string
  duration: Duration
}

export function draftOf(status: CustomStatus | null): StatusDraft {
  return { emoji: status?.emoji ?? null, text: status?.text ?? '', duration: status?.expires_at ? 'keep' : 'never' }
}

/** The status to save, or null to clear it. `previous` keeps its expiry with 'keep'. */
export function statusFromDraft(draft: StatusDraft, previous: CustomStatus | null): CustomStatus | null {
  const text = draft.text.trim()
  if (!text && !draft.emoji) return null
  const now = new Date()
  const at = (ms: number): string => new Date(now.getTime() + ms).toISOString()
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()
  const expires_at = {
    keep: previous?.expires_at ?? null,
    '30m': at(30 * 60_000),
    '1h': at(60 * 60_000),
    '4h': at(4 * 60 * 60_000),
    today: endOfDay,
    never: null
  }[draft.duration]
  return { emoji: draft.emoji, text, expires_at }
}

/** Emoji, text and "clear after" of the custom status (the bubble next to the avatar). */
export function CustomStatusEditor({
  draft,
  previous,
  onChange
}: {
  draft: StatusDraft
  previous: CustomStatus | null
  onChange(draft: StatusDraft): void
}): ReactNode {
  const [picking, setPicking] = useState(false)
  const keep = previous?.expires_at && new Date(previous.expires_at) > new Date()
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          title="Escolher emoji"
          aria-label="Escolher emoji"
          aria-expanded={picking}
          onClick={() => setPicking((v) => !v)}
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-control border border-line bg-main text-xl hover:border-accent"
        >
          {draft.emoji ?? <span className="text-sm text-fg-subtle">+</span>}
        </button>
        <input
          maxLength={128}
          value={draft.text}
          onChange={(e) => onChange({ ...draft, text: e.target.value })}
          placeholder="Como você está?"
          aria-label="Texto do status"
          className={`${inputClass} min-w-0`}
        />
        {(draft.text || draft.emoji) && (
          <button
            type="button"
            title="Limpar status"
            aria-label="Limpar status"
            onClick={() => onChange({ emoji: null, text: '', duration: 'never' })}
            className="shrink-0 rounded-control px-2 text-fg-muted hover:bg-elevated hover:text-fg"
          >
            <X size={18} />
          </button>
        )}
      </div>
      {picking && (
        <div className="flex flex-wrap gap-1 rounded-control border border-line bg-main p-2">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onChange({ ...draft, emoji })
                setPicking(false)
              }}
              className={`h-9 w-9 rounded-item text-lg hover:bg-elevated ${draft.emoji === emoji ? 'bg-elevated' : ''}`}
            >
              {emoji}
            </button>
          ))}
          {draft.emoji && (
            <button type="button" onClick={() => onChange({ ...draft, emoji: null })} className="px-2 text-xs text-fg-muted hover:text-fg">
              Sem emoji
            </button>
          )}
        </div>
      )}
      <label className="block">
        <span className={labelClass}>Limpar depois de</span>
        <select value={draft.duration} onChange={(e) => onChange({ ...draft, duration: e.target.value as Duration })} className={inputClass}>
          {keep && <option value="keep">Manter ({expiryFmt.format(new Date(previous.expires_at!))})</option>}
          {DURATIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

/** Quick way to set the status from the profile menu. */
export function CustomStatusModal({ me, onClose }: { me: Me; onClose(): void }): ReactNode {
  const { setUser } = useAuth()
  const [draft, setDraft] = useState(() => draftOf(me.custom_status))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setUser(await api<Me>('/users/me', { method: 'PATCH', body: { custom_status: statusFromDraft(draft, me.custom_status) } }))
      onClose()
    } catch (err) {
      setError(errorText(err, 'Não foi possível salvar o status.'))
      setBusy(false)
    }
  }

  return (
    <Modal title="Status personalizado" onClose={onClose}>
      <div className="space-y-4">
        <FormError message={error} />
        <CustomStatusEditor draft={draft} previous={me.custom_status} onChange={setDraft} />
        <PrimaryButton type="button" disabled={busy} onClick={() => void save()}>
          {busy ? 'Salvando…' : 'Salvar'}
        </PrimaryButton>
      </div>
    </Modal>
  )
}
