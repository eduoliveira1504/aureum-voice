import type { ReactNode } from 'react'

import type { Channel, Member, ServerDetail } from '../../lib/api'
import { memberName } from '../../lib/members'
import { channelPermissions, has, Perm } from '../../lib/permissions'
import type { HistoryEntry, KanbanLabel, LabelColor } from './store'
import { dateFormat } from '../../lib/format'
import { t } from '../../lib/i18n'

export const labelColorName = (color: LabelColor): string => t(`addons.kanban.colors.${color}`)

/** A label's colors, from its --label-<color> token. */
export function labelStyle(color: LabelColor): { color: string; background: string } {
  return { color: `var(--label-${color})`, background: `color-mix(in oklab, var(--label-${color}) 16%, transparent)` }
}

export function LabelChip({ label, small = false }: { label: KanbanLabel; small?: boolean }): ReactNode {
  return (
    <span
      style={labelStyle(label.color)}
      className={`inline-flex max-w-full items-center truncate rounded-full font-semibold ${small ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'}`}
    >
      {label.name}
    </span>
  )
}

/** Who can see the board: the people a card can be assigned to. */
export function boardMembers(server: ServerDetail, channel: Channel): Member[] {
  return server.members
    .filter((m) => has(channelPermissions(server, channel, m.user.id), Perm.VIEW_CHANNEL))
    .sort((a, b) => memberName(a).localeCompare(memberName(b)))
}

const DAY = { day: '2-digit', month: 'short' } as const
const WHEN = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' } as const

/** A due date (YYYY-MM-DD, a calendar day with no time zone) and whether it has passed. */
export function dueInfo(due: string): { text: string; late: boolean } {
  const [y, m, d] = due.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return { text: dateFormat(DAY).format(date).replace('.', ''), late: date < today }
}

export const formatWhen = (iso: string): string => dateFormat(WHEN).format(new Date(iso))

const FIELDS = new Set(['title', 'description', 'assignee', 'labels', 'due_date'])
const fieldName = (field: string): string => (FIELDS.has(field) ? t(`addons.kanban.fields.${field as 'title'}`) : field)

/** One history entry in words, without the actor ("moveu “Login” de A fazer para Feito"). */
export function describe(entry: HistoryEntry): string {
  const d = entry.data as Record<string, string> & { fields?: string[] }
  switch (entry.action) {
    case 'card.created':
      return t('addons.kanban.history.created', { title: d.title, column: d.column })
    case 'card.updated':
      return t('addons.kanban.history.updated', { fields: (d.fields ?? []).map(fieldName).join(', '), title: d.title })
    case 'card.moved':
      return t('addons.kanban.history.moved', { title: d.title, from: d.from, to: d.to })
    case 'card.deleted':
      return t('addons.kanban.history.deleted', { title: d.title })
    case 'column.created':
      return t('addons.kanban.history.columnCreated', { name: d.name })
    case 'column.updated':
      return d.old_name && d.old_name !== d.name
        ? t('addons.kanban.history.columnRenamed', { old: d.old_name, name: d.name })
        : t('addons.kanban.history.columnUpdated', { name: d.name })
    case 'column.deleted':
      return t('addons.kanban.history.columnDeleted', { name: d.name })
    default:
      return entry.action
  }
}
