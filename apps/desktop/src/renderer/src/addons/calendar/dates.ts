import type { AgendaItem } from '../../lib/api'

export type View = 'month' | 'week' | 'list'

/** Days the list view shows, from today. */
export const LIST_DAYS = 30

const pad = (n: number): string => String(n).padStart(2, '0')

/** YYYY-MM-DD of a local day. */
export const ymd = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** Weeks start on Sunday, as on Brazilian calendars. */
export const startOfWeek = (date: Date): Date => addDays(startOfDay(date), -date.getDay())

/** The days a view shows around `anchor`: six weeks for a month (so every month fits the same
 * grid), seven for a week, LIST_DAYS from the anchor for the list. */
export function viewDays(view: View, anchor: Date): Date[] {
  if (view === 'list') return Array.from({ length: LIST_DAYS }, (_, i) => addDays(startOfDay(anchor), i))
  if (view === 'week') return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  return Array.from({ length: 42 }, (_, i) => addDays(startOfWeek(first), i))
}

/** Where `anchor` goes with the arrows. */
export function shift(view: View, anchor: Date, step: -1 | 1): Date {
  if (view === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + step, 1)
  return addDays(anchor, step * (view === 'week' ? 7 : LIST_DAYS))
}

const monthTitle = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
const shortDay = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })

export function viewTitle(view: View, anchor: Date): string {
  if (view === 'month') return monthTitle.format(anchor)
  const days = viewDays(view, anchor)
  return `${shortDay.format(days[0])} – ${shortDay.format(days[days.length - 1])}`
}

/** Whether the item is on that local day: an all-day one on its date, a timed one when it
 * overlaps the day. */
export function onDay(item: AgendaItem, day: Date): boolean {
  if (item.all_day) return item.day === ymd(day)
  const start = new Date(item.starts_at!).getTime()
  const end = item.ends_at ? new Date(item.ends_at).getTime() : start + 1
  const dayStart = startOfDay(day).getTime()
  return start < addDays(startOfDay(day), 1).getTime() && end > dayStart
}

/** All-day items first, then by time. */
export function dayItems(items: AgendaItem[], day: Date): AgendaItem[] {
  return items
    .filter((i) => onDay(i, day))
    .sort((a, b) => Number(b.all_day) - Number(a.all_day) || (a.starts_at ?? '').localeCompare(b.starts_at ?? '') || a.title.localeCompare(b.title))
}

/** A card past its due date and not done. */
export const isOverdue = (item: AgendaItem, today: Date = new Date()): boolean =>
  item.all_day && !item.done && !item.cancelled && !!item.day && item.day < ymd(today)

const PALETTE = ['blue', 'green', 'orange', 'purple', 'pink', 'teal', 'yellow', 'red'] as const

/** One color per source channel (a --label-<color> token name), in the sources' order. */
export function sourceColors(channelIds: string[]): Record<string, string> {
  return Object.fromEntries(channelIds.map((id, i) => [id, PALETTE[i % PALETTE.length]]))
}

export function colorStyle(color: string): { color: string; background: string } {
  return { color: `var(--label-${color})`, background: `color-mix(in oklab, var(--label-${color}) 16%, transparent)` }
}
