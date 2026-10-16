import { Check, Search } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'

import { ApiError } from '../lib/api'
import { useSocial } from '../store/social'
import { FormError, Modal } from './Modal'
import { Field, inputClass, PresenceAvatar, PrimaryButton } from './ui'

const MAX_GROUP = 10

function socialError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'Só dá pra fazer isso com amigos.'
    if (typeof err.detail === 'string' && err.detail.startsWith('Groups hold')) return `Grupos têm no máximo ${MAX_GROUP} pessoas.`
  }
  return err instanceof TypeError ? 'Não foi possível conectar ao servidor.' : fallback
}

/**
 * Picks friends: for a new group, or to add people to a group or call. `taken` are already in
 * (they count toward the 10-person limit and aren't listed).
 */
export function PickFriendsModal({
  title,
  subtitle,
  confirmLabel,
  taken = [],
  withName = false,
  onConfirm,
  onClose
}: {
  title: string
  subtitle?: string
  confirmLabel: string
  taken?: string[]
  /** Also asks for a (optional) group name. */
  withName?: boolean
  onConfirm(userIds: string[], name: string): Promise<void>
  onClose(): void
}): ReactNode {
  const friends = useSocial((s) => s.friends)
  const presence = useSocial((s) => s.presence)
  const [picked, setPicked] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const room = MAX_GROUP - Math.max(1, taken.length) // the group always includes you
  const q = query.trim().toLowerCase()
  const list = Object.values(friends)
    .filter((f) => f.kind === 'friend' && !taken.includes(f.user.id))
    .filter((f) => !q || f.user.display_name.toLowerCase().includes(q) || f.user.username.includes(q))
    .sort((a, b) => a.user.display_name.localeCompare(b.user.display_name))

  const toggle = (id: string): void =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < room ? [...p, id] : p))

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!picked.length) return setError('Escolha pelo menos um amigo.')
    setBusy(true)
    setError(null)
    try {
      await onConfirm(picked, name.trim())
      onClose()
    } catch (err) {
      setError(socialError(err, 'Algo deu errado. Tente de novo.'))
      setBusy(false)
    }
  }

  return (
    <Modal title={title} subtitle={subtitle ?? `Você pode escolher mais ${room - picked.length}.`} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <FormError message={error} />
        {withName && (
          <Field label="Nome do grupo (opcional)" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Squad da sexta" />
        )}
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar amigos"
            aria-label="Buscar amigos"
            className={`${inputClass} pl-9`}
          />
        </label>
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {list.length === 0 && (
            <p className="py-6 text-center text-sm text-fg-subtle">
              {Object.values(friends).some((f) => f.kind === 'friend') ? 'Ninguém com esse nome.' : 'Adicione amigos primeiro.'}
            </p>
          )}
          {list.map((f) => {
            const on = picked.includes(f.user.id)
            return (
              <button
                key={f.user.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(f.user.id)}
                className={`flex w-full items-center gap-3 rounded-item px-2 py-1.5 text-left ${on ? 'bg-accent/10' : 'hover:bg-elevated'}`}
              >
                <PresenceAvatar name={f.user.display_name} url={f.user.avatar_url} status={presence[f.user.id] ?? f.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{f.user.display_name}</span>
                  <span className="block truncate text-xs text-fg-subtle">@{f.user.username}</span>
                </span>
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded border ${on ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}
                >
                  {on && <Check size={14} />}
                </span>
              </button>
            )
          })}
        </div>
        <PrimaryButton type="submit" disabled={busy || picked.length === 0}>
          {busy ? 'Aguarde…' : confirmLabel}
        </PrimaryButton>
      </form>
    </Modal>
  )
}

export function RenameGroupModal({ id, current, onClose }: { id: string; current: string | null; onClose(): void }): ReactNode {
  const renameGroup = useSocial((s) => s.renameGroup)
  const [name, setName] = useState(current ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    try {
      await renameGroup(id, name.trim() || null)
      onClose()
    } catch (err) {
      setError(socialError(err, 'Não foi possível renomear o grupo.'))
      setBusy(false)
    }
  }

  return (
    <Modal title="Renomear grupo" subtitle="Deixe vazio para usar os nomes das pessoas." onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <FormError message={error} />
        <Field autoFocus label="Nome do grupo" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar'}
        </PrimaryButton>
      </form>
    </Modal>
  )
}
