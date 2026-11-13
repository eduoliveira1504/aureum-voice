import { Check, RotateCcw, Wrench, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { api, fetchMedia, type BugReport } from '../lib/api'
import { dateFormat } from '../lib/format'
import { t as translate } from '../lib/i18n'
import { toast } from './ContextMenu'
import { errorText } from './modals'
import { Avatar, Segmented } from './ui'

const actionClass = 'flex items-center gap-1.5 rounded-control px-2 py-1 text-xs font-medium text-fg-muted hover:bg-elevated hover:text-fg'
const DATE_TIME = { dateStyle: 'short', timeStyle: 'short' } as const

/** Settings > Problemas reportados: only the app owner sees this tab (and the API agrees). */
export function BugReports(): ReactNode {
  const { t } = useTranslation()
  const [reports, setReports] = useState<BugReport[] | null>(null)
  const [filter, setFilter] = useState<'open' | 'closed'>('open')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<BugReport[]>('/bug-reports').then(setReports, (err) => setError(errorText(err, translate('common.loadError'))))
  }, [])

  /** confirmed: the bot says it's being fixed. resolved: badge, the bot's thanks and DM.
   *  dismissed: "não é bug", none of that. */
  async function update(
    report: BugReport,
    change: { confirmed: boolean } | { resolved: boolean } | { dismissed: boolean }
  ): Promise<void> {
    try {
      const updated = await api<BugReport>(`/bug-reports/${report.id}`, { method: 'PATCH', body: change })
      setReports((list) => list?.map((r) => (r.id === updated.id ? updated : r)) ?? null)
    } catch (err) {
      toast(errorText(err, t('common.tryAgainError')))
    }
  }

  if (error) return <p className="text-sm text-danger">{error}</p>
  if (!reports) return <p className="text-sm text-fg-muted">{t('common.loading')}</p>
  const closed = (r: BugReport): boolean => !!r.resolved_at || !!r.dismissed_at
  const shown = reports.filter((r) => (filter === 'closed') === closed(r))
  const open = reports.filter((r) => !closed(r)).length

  return (
    <div className="space-y-3">
      <Segmented<'open' | 'closed'>
        options={[
          { value: 'open', label: t('bugs.open', { count: open }) },
          { value: 'closed', label: t('bugs.closed', { count: reports.length - open }) }
        ]}
        value={filter}
        onChange={setFilter}
      />
      {shown.length === 0 && <p className="py-6 text-center text-sm text-fg-muted">{t('common.nothingHere')}</p>}
      {shown.map((r) => (
        <article key={r.id} className="rounded-control border border-line bg-main p-3">
          <header className="flex items-center gap-2">
            <Avatar name={r.author?.display_name ?? '?'} url={r.author?.avatar_url ?? null} gif={r.author?.avatar_gif} size={24} />
            <span className="truncate text-sm font-semibold">{r.author ? `@${r.author.username}` : t('bugs.deletedAccount')}</span>
            <span className="text-xs text-fg-subtle">{dateFormat(DATE_TIME).format(new Date(r.created_at))}</span>
            {closed(r) ? (
              <>
                <span className="ml-auto text-xs text-fg-subtle">{r.resolved_at ? t('bugs.resolved') : t('bugs.notBug')}</span>
                <button
                  type="button"
                  onClick={() => void update(r, r.resolved_at ? { resolved: false } : { dismissed: false })}
                  className={actionClass}
                >
                  <RotateCcw size={14} />
                  {t('bugs.reopen')}
                </button>
              </>
            ) : (
              <>
                {r.confirmed_at ? (
                  <span className="ml-auto text-xs text-fg-subtle">{t('bugs.confirmed')}</span>
                ) : (
                  <button
                    type="button"
                    title={t('bugs.confirmHint')}
                    onClick={() => void update(r, { confirmed: true })}
                    className={`ml-auto ${actionClass}`}
                  >
                    <Wrench size={14} />
                    {t('bugs.confirm')}
                  </button>
                )}
                <button type="button" onClick={() => void update(r, { resolved: true })} className={actionClass}>
                  <Check size={14} />
                  {t('bugs.resolve')}
                </button>
                <button
                  type="button"
                  title={t('bugs.dismissHint')}
                  onClick={() => void update(r, { dismissed: true })}
                  className={actionClass}
                >
                  <X size={14} />
                  {t('bugs.dismiss')}
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
              <summary className="cursor-pointer select-none">{t('bugs.logs')}</summary>
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
  const { t } = useTranslation()
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
  return <img src={src} alt={t('bugs.screenshot')} className="mt-2 max-h-72 rounded-control border border-line object-contain" />
}
