import { useEffect, useRef, useState, type ReactNode } from 'react'

import { ToggleRow } from '../../components/ui'
import { ApiError } from '../../lib/api'
import { memberName } from '../../lib/members'
import { has, Perm } from '../../lib/permissions'
import type { AddonSettingsProps, AddonViewProps } from '../types'
import { useNotes } from './store'

const SAVE_DELAY_MS = 800
const MAX_LENGTH = 20_000

/** Mirrors the API: read-only pages are left to who manages addons. */
function canEdit({ channel, perms }: AddonViewProps): boolean {
  return has(perms, channel.config.read_only ? Perm.MANAGE_ADDONS : Perm.SEND_MESSAGES)
}

const timeFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function NotesPanel(props: AddonViewProps): ReactNode {
  const { server, channel } = props
  const page = useNotes((s) => s.pages[channel.id])
  const editable = canEdit(props)
  // Unsaved local text; null while there's nothing pending (the page from the server shows).
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  // The version the draft was based on.
  const base = useRef(0)
  const latest = useRef({ draft, editable })
  latest.current = { draft, editable }

  useEffect(() => {
    void useNotes
      .getState()
      .load(channel.id)
      .catch(() => setError('Não foi possível abrir a página.'))
  }, [channel.id])

  // Someone else saved while we had unsaved text.
  const conflict = draft !== null && !saving && !!page && page.version > base.current

  async function save(text: string): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      const saved = await useNotes.getState().save(channel.id, text, base.current)
      base.current = saved.version
      setDraft((d) => (d === text ? null : d))
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) await useNotes.getState().load(channel.id)
      else setError(err instanceof ApiError && err.status === 403 ? 'Você não pode editar esta página.' : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
      setTick((t) => t + 1) // typed during the save: save again
    }
  }

  useEffect(() => {
    if (draft === null || saving || conflict || !editable) return
    const timer = setTimeout(() => void save(draft), SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [draft, saving, conflict, editable, tick])

  // Leaving the panel doesn't lose what was typed.
  useEffect(
    () => () => {
      const { draft: pending, editable: can } = latest.current
      if (pending !== null && can) void useNotes.getState().save(channel.id, pending, base.current).catch(() => {})
    },
    [channel.id]
  )

  const edit = (text: string): void => {
    if (draft === null) base.current = page?.version ?? 0
    setDraft(text)
  }

  const author = page?.updated_by ? server.members.find((m) => m.user.id === page.updated_by) : undefined
  const status = !editable
    ? 'Somente leitura'
    : saving
      ? 'Salvando…'
      : draft !== null
        ? 'Alterações não salvas'
        : page?.version
          ? 'Salvo'
          : ''

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {conflict && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-line bg-accent/10 px-4 py-2 text-sm">
          <span className="flex-1">
            {author ? memberName(author) : 'Alguém'} salvou outra versão enquanto você editava.
          </span>
          <button type="button" onClick={() => setDraft(null)} className="font-semibold text-accent-text hover:underline">
            Ver a versão nova
          </button>
          <button
            type="button"
            onClick={() => {
              base.current = page?.version ?? 0
              setTick((t) => t + 1)
            }}
            className="font-semibold text-fg-muted hover:text-fg hover:underline"
          >
            Manter a minha
          </button>
        </div>
      )}
      <textarea
        aria-label={channel.name ?? 'Bloco de notas'}
        value={draft ?? page?.content ?? ''}
        readOnly={!editable || !page}
        maxLength={MAX_LENGTH}
        onChange={(e) => edit(e.target.value)}
        placeholder={editable ? 'Escreva aqui. Todo mundo do canal vê as mudanças na hora.' : 'Página em branco.'}
        className="min-h-0 flex-1 resize-none bg-main px-6 py-5 text-[15px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
      />
      <footer className="flex h-9 shrink-0 items-center gap-3 border-t border-line px-4 text-xs text-fg-subtle">
        {error ? <span className="text-danger">{error}</span> : <span>{status}</span>}
        {page?.updated_at && page.version > 0 && (
          <span className="ml-auto truncate">
            Editado por {author ? memberName(author) : 'alguém'} em {timeFmt.format(new Date(page.updated_at))}
          </span>
        )}
      </footer>
    </div>
  )
}

export function NotesSummary({ channel }: AddonViewProps): ReactNode {
  const page = useNotes((s) => s.pages[channel.id])
  useEffect(() => {
    if (!useNotes.getState().pages[channel.id]) void useNotes.getState().load(channel.id).catch(() => {})
  }, [channel.id])
  const lines = (page?.content ?? '').split('\n').filter((l) => l.trim())
  if (!lines.length) return <span className="text-sm text-fg-subtle">Página em branco.</span>
  return <span className="line-clamp-2 whitespace-pre-line text-sm text-fg-muted">{lines.slice(0, 2).join('\n')}</span>
}

export function NotesSettings({ config, onChange }: AddonSettingsProps): ReactNode {
  return (
    <ToggleRow
      title="Somente leitura"
      description="Só quem pode gerenciar addons edita; o resto do canal só lê."
      checked={!!config.read_only}
      onChange={(read_only) => onChange({ ...config, read_only })}
    />
  )
}
