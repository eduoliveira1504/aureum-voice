import { Check, RotateCcw, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { api, fetchMedia, type BugReport } from '../lib/api'
import { toast } from './ContextMenu'
import { errorText } from './modals'
import { Avatar, Segmented } from './ui'

const actionClass = 'flex items-center gap-1.5 rounded-control px-2 py-1 text-xs font-medium text-fg-muted hover:bg-elevated hover:text-fg'
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/** Settings > Problemas reportados: only the app owner sees this tab (and the API agrees). */
export function BugReports(): ReactNode {
  const [reports, setReports] = useState<BugReport[] | null>(null)
  const [filter, setFilter] = useState<'open' | 'closed'>('open')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<BugReport[]>('/bug-reports').then(setReports, (err) => setError(errorText(err, 'Não foi possível carregar.')))
  }, [])

  /** resolved: badge, the bot's thanks and DM. dismissed: "não é bug", none of that. */
  async function update(report: BugReport, change: { resolved: boolean } | { dismissed: boolean }): Promise<void> {
    try {
      const updated = await api<BugReport>(`/bug-reports/${report.id}`, { method: 'PATCH', body: change })
      setReports((list) => list?.map((r) => (r.id === updated.id ? updated : r)) ?? null)
    } catch (err) {
      toast(errorText(err, 'Não deu certo. Tente de novo.'))
    }
  }

  if (error) return <p className="text-sm text-danger">{error}</p>
  if (!reports) return <p className="text-sm text-fg-muted">Carregando…</p>
  const closed = (r: BugReport): boolean => !!r.resolved_at || !!r.dismissed_at
  const shown = reports.filter((r) => (filter === 'closed') === closed(r))
  const open = reports.filter((r) => !closed(r)).length

  return (
    <div className="space-y-3">
      <Segmented<'open' | 'closed'>
        options={[
          { value: 'open', label: `Abertos (${open})` },
          { value: 'closed', label: `Fechados (${reports.length - open})` }
        ]}
        value={filter}
        onChange={setFilter}
      />
      {shown.length === 0 && <p className="py-6 text-center text-sm text-fg-muted">Nada por aqui.</p>}
      {shown.map((r) => (
        <article key={r.id} className="rounded-control border border-line bg-main p-3">
          <header className="flex items-center gap-2">
            <Avatar name={r.author?.display_name ?? '?'} url={r.author?.avatar_url ?? null} size={24} />
            <span className="truncate text-sm font-semibold">{r.author ? `@${r.author.username}` : 'Conta apagada'}</span>
            <span className="text-xs text-fg-subtle">{dateTime.format(new Date(r.created_at))}</span>
            {closed(r) ? (
              <>
                <span className="ml-auto text-xs text-fg-subtle">{r.resolved_at ? 'Resolvido' : 'Não é bug'}</span>
                <button
                  type="button"
                  onClick={() => void update(r, r.resolved_at ? { resolved: false } : { dismissed: false })}
                  className={actionClass}
                >
                  <RotateCcw size={14} />
                  Reabrir
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => void update(r, { resolved: true })} className={`ml-auto ${actionClass}`}>
                  <Check size={14} />
                  Marcar como resolvido
                </button>
                <button
                  type="button"
                  title="Fecha sem insígnia, sem aviso no canal e sem mensagem pra pessoa"
                  onClick={() => void update(r, { dismissed: true })}
                  className={actionClass}
                >
                  <X size={14} />
                  Fechar (não é bug)
                </button>
              </>
            )}
          </header>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">{r.description}</p>
          <p className="mt-1 text-xs text-fg-subtle">
            {r.app_version} · {r.os}
          </p>
          {r.screenshot_url && <Screenshot url={r.screenshot_url} />}
          {r.logs && (
            <details className="mt-2 text-xs text-fg-subtle">
              <summary className="cursor-pointer select-none">Registros do app</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-control border border-line bg-panel p-2 font-mono text-[11px]">
                {r.logs}
              </pre>
            </details>
          )}
        </article>
      ))}
    </div>
  )
}

/** The screenshot is protected (owner only), so it's fetched with the token. */
function Screenshot({ url }: { url: string }): ReactNode {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | null = null
    fetchMedia(url, controller.signal).then(
      (blob) => setSrc((objectUrl = URL.createObjectURL(blob))),
      () => {}
    )
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])
  if (!src) return null
  return <img src={src} alt="Print enviado" className="mt-2 max-h-72 rounded-control border border-line object-contain" />
}
