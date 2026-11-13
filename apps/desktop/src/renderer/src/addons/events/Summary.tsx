import { useEffect, type ReactNode } from 'react'

import type { AddonViewProps } from '../types'
import { countLabel, DateBlock, whenLabel } from './bits'
import { splitEvents, useEvents } from './store'
import { t } from '../../lib/i18n'

const SHOWN = 3

/** The channel's card on the server overview: "Próximos eventos", the next few. */
export function EventsSummary({ channel }: AddonViewProps): ReactNode {
  const list = useEvents((s) => s.lists[channel.id])
  useEffect(() => {
    if (!useEvents.getState().lists[channel.id]) void useEvents.getState().load(channel.id).catch(() => {})
  }, [channel.id])

  if (!list) return <span className="text-sm text-fg-subtle">{t('common.loading')}</span>
  const next = splitEvents(list.events).upcoming.filter((e) => !e.cancelled_at).slice(0, SHOWN)
  if (!next.length) return <span className="text-sm text-fg-subtle">{t('addons.events.panel.empty')}</span>
  return (
    <span className="block space-y-2">
      <span className="block text-xs font-semibold uppercase tracking-wide text-fg-subtle">{t('addons.events.summary.next')}</span>
      {next.map((event) => (
        <span key={event.id} className="flex items-center gap-2.5">
          <DateBlock iso={event.occurrence.starts_at} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{event.title}</span>
            <span className="block truncate text-xs text-fg-subtle">
              {whenLabel(event.occurrence.starts_at, event.occurrence.ends_at)} · {countLabel(event)}
            </span>
          </span>
        </span>
      ))}
    </span>
  )
}
