import { useEffect, useState, type ReactNode } from 'react'

import { api, type AgendaItem } from '../../lib/api'
import type { AddonViewProps } from '../types'
import { addDays, isOverdue, startOfDay } from './dates'
import { calendarPath } from './store'

const SHOWN = 3
const dayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

function when(item: AgendaItem): string {
  if (item.all_day && item.day) {
    const [y, m, d] = item.day.split('-').map(Number)
    return dayFmt.format(new Date(y, m - 1, d))
  }
  const start = new Date(item.starts_at!)
  return `${dayFmt.format(start)}, ${timeFmt.format(start)}`
}

/** The calendar's card on the server overview: what's coming in the next 7 days. */
export function CalendarSummary({ channel }: AddonViewProps): ReactNode {
  const [items, setItems] = useState<AgendaItem[] | null>(null)
  useEffect(() => {
    const today = startOfDay(new Date())
    api<{ items: AgendaItem[] }>(calendarPath(channel.id, today, addDays(today, 7))).then(
      (data) => setItems(data.items.filter((i) => !i.done && !i.cancelled)),
      () => setItems([])
    )
  }, [channel.id])

  if (!items) return <span className="text-sm text-fg-subtle">Carregando…</span>
  if (!items.length) return <span className="text-sm text-fg-subtle">Nada nos próximos 7 dias.</span>
  return (
    <span className="block space-y-1.5">
      {items.slice(0, SHOWN).map((item) => (
        <span key={item.id} className="flex items-baseline gap-2 text-sm">
          <span className={`shrink-0 text-xs ${isOverdue(item) ? 'text-danger' : 'text-fg-subtle'}`}>{when(item)}</span>
          <span className="truncate font-medium">{item.title}</span>
        </span>
      ))}
      {items.length > SHOWN && <span className="block text-xs text-fg-subtle">e mais {items.length - SHOWN}</span>}
    </span>
  )
}
