import { useEffect, type ReactNode } from 'react'

import type { AddonViewProps } from '../types'
import { countByStage } from './KanbanPanel'
import { useKanban } from './store'
import { t } from '../../lib/i18n'

/** The board's card on the server overview: how much is to do, in progress and done. */
export function KanbanSummary({ channel }: AddonViewProps): ReactNode {
  const board = useKanban((s) => s.boards[channel.id])
  useEffect(() => {
    if (!useKanban.getState().boards[channel.id]) void useKanban.getState().load(channel.id).catch(() => {})
  }, [channel.id])

  if (!board) return <span className="text-sm text-fg-subtle">{t('common.loading')}</span>
  const counts = countByStage(board)
  const total = counts.todo + counts.doing + counts.done
  if (!total) return <span className="text-sm text-fg-subtle">{t('addons.kanban.summary.empty')}</span>
  const width = (n: number): string => `${(n / total) * 100}%`
  return (
    <span className="block space-y-2">
      <span
        role="img"
        aria-label={t('addons.kanban.summary.doneOf', { done: counts.done, total })}
        className="flex h-2 overflow-hidden rounded-full bg-elevated"
      >
        <span className="bg-success" style={{ width: width(counts.done) }} />
        <span className="bg-idle" style={{ width: width(counts.doing) }} />
      </span>
      <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
        <Legend dot="bg-fg-subtle" label={t('addons.kanban.summary.todo', { count: counts.todo })} />
        <Legend dot="bg-idle" label={t('addons.kanban.summary.doing', { count: counts.doing })} />
        <Legend dot="bg-success" label={t('addons.kanban.summary.done', { count: counts.done })} />
      </span>
    </span>
  )
}

function Legend({ dot, label }: { dot: string; label: string }): ReactNode {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  )
}
