import type { ReactNode } from 'react'

import type { Channel, Member, ServerDetail } from '../../lib/api'
import { memberName } from '../../lib/members'
import { channelPermissions, has, Perm } from '../../lib/permissions'
import type { HistoryEntry, KanbanLabel, LabelColor } from './store'

export const LABEL_COLOR_NAME: Record<LabelColor, string> = {
  gray: 'Cinza',
  red: 'Vermelho',
  orange: 'Laranja',
  yellow: 'Amarelo',
  green: 'Verde',
  teal: 'Turquesa',
  blue: 'Azul',
  purple: 'Roxo',
  pink: 'Rosa'
}

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

const dayFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
const timeFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** A due date (YYYY-MM-DD, a calendar day with no time zone) and whether it has passed. */
export function dueInfo(due: string): { text: string; late: boolean } {
  const [y, m, d] = due.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return { text: dayFmt.format(date).replace('.', ''), late: date < today }
}

export const formatWhen = (iso: string): string => timeFmt.format(new Date(iso))

const FIELD_NAME: Record<string, string> = {
  title: 'título',
  description: 'descrição',
  assignee: 'responsável',
  labels: 'etiquetas',
  due_date: 'prazo'
}

/** One history entry in words, without the actor ("moveu “Login” de A fazer para Feito"). */
export function describe(entry: HistoryEntry): string {
  const d = entry.data as Record<string, string> & { fields?: string[] }
  switch (entry.action) {
    case 'card.created':
      return `criou “${d.title}” em ${d.column}`
    case 'card.updated':
      return `mudou ${(d.fields ?? []).map((f) => FIELD_NAME[f] ?? f).join(', ')} de “${d.title}”`
    case 'card.moved':
      return `moveu “${d.title}” de ${d.from} para ${d.to}`
    case 'card.deleted':
      return `excluiu “${d.title}”`
    case 'column.created':
      return `criou a coluna ${d.name}`
    case 'column.updated':
      return d.old_name && d.old_name !== d.name ? `renomeou a coluna ${d.old_name} para ${d.name}` : `alterou a coluna ${d.name}`
    case 'column.deleted':
      return `excluiu a coluna ${d.name}`
    default:
      return entry.action
  }
}
