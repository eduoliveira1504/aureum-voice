import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { Segmented } from '../../components/ui'
import type { AgendaItem, ServerDetail } from '../../lib/api'
import { channelPermissions, has, Perm } from '../../lib/permissions'
import { useNav } from '../../store/nav'
import type { AddonViewProps } from '../types'
import { addDays, colorStyle, dayItems, isOverdue, shift, sourceColors, startOfDay, viewDays, viewTitle, ymd, type View } from './dates'
import { useCalendar, type AgendaSource } from './store'
import { dateFormat } from '../../lib/format'
import { t } from '../../lib/i18n'

const VIEWS: readonly View[] = ['month', 'week', 'list']
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const
// A month cell shows this many items, then "+N".
const CELL_ITEMS = 3

const TIME = { hour: '2-digit', minute: '2-digit' } as const
const LIST_DAY = { weekday: 'long', day: 'numeric', month: 'long' } as const

/** The events channel where the user can create events, for "Criar evento" on a day. */
export function eventsChannelFor(server: ServerDetail, meId: string): string | null {
  const channel = server.channels.find(
    (c) => c.type === 'addon' && c.addon_key === 'events' && has(channelPermissions(server, c, meId), Perm.MANAGE_EVENTS | Perm.MANAGE_ADDONS)
  )
  return channel?.id ?? null
}

function sourceName(source: AgendaSource, sources: AgendaSource[]): string {
  const kind = source.addon_key === 'events' || source.addon_key === 'kanban' ? t(`addons.calendar.sources.${source.addon_key}`) : source.channel_name
  // With one channel of a kind, its kind names it; with several, each one's name does.
  return sources.filter((s) => s.addon_key === source.addon_key).length > 1 ? t('addons.calendar.sourceIn', { kind, channel: source.channel_name }) : kind
}

/** Month, week and list views of the server's dates (events, due dates), with filters. */
export function CalendarPanel({ server, channel, me }: AddonViewProps): ReactNode {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [onlyMine, setOnlyMine] = useState(false)
  const [error, setError] = useState(false)
  const data = useCalendar((s) => s.views[channel.id])
  const eventsChannel = eventsChannelFor(server, me.id)

  const load = useCallback(
    (start: Date, end: Date) => {
      setError(false)
      useCalendar.getState().load(channel.id, start, end).catch(() => setError(true))
    },
    [channel.id]
  )
  // Off screen, nothing to keep fresh.
  useEffect(() => () => useCalendar.getState().drop(channel.id), [channel.id])

  const sources = data?.sources ?? []
  const colors = useMemo(() => sourceColors(sources.map((s) => s.channel_id)), [sources])
  const items = (data?.items ?? []).filter((i) => !hidden.has(i.channel_id) && (!onlyMine || i.mine))
  const toggle = (id: string): void =>
    setHidden((h) => {
      const next = new Set(h)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <CalendarBoard
      items={items}
      error={error}
      onRange={load}
      colorOf={(item) => colors[item.channel_id] ?? 'gray'}
      onOpen={(item) => useNav.getState().openAddonItem(server.id, item.channel_id, item.item_id)}
      onCreate={eventsChannel ? (day) => useNav.getState().openAddonItem(server.id, eventsChannel, `new:${ymd(day)}`) : undefined}
      filters={
        <>
          {sources.map((source) => (
            <FilterChip
              key={source.channel_id}
              on={!hidden.has(source.channel_id)}
              color={colors[source.channel_id]}
              label={sourceName(source, sources)}
              onToggle={() => toggle(source.channel_id)}
            />
          ))}
          {!sources.length && data && <span className="text-fg-subtle">{t('addons.calendar.noSources')}</span>}
          <OnlyMine checked={onlyMine} onChange={setOnlyMine} />
        </>
      }
    />
  )
}

/** One source of items, on or off. */
export function FilterChip({ on, color, label, onToggle }: { on: boolean; color: string; label: ReactNode; onToggle(): void }): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      style={on ? colorStyle(color) : undefined}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ${on ? 'border-transparent' : 'border-line text-fg-subtle line-through'}`}
    >
      {label}
    </button>
  )
}

export function OnlyMine({ checked, onChange }: { checked: boolean; onChange(checked: boolean): void }): ReactNode {
  return (
    <label className="ml-auto flex cursor-pointer items-center gap-1.5 font-medium text-fg-muted">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-accent" />
      {t('addons.calendar.onlyMine')}
    </label>
  )
}

/**
 * The calendar itself, for a server's channel and for Home: view switch, navigation, filters row
 * and the items. It asks `onRange` for the days on screen; what to show comes in `items`.
 */
export function CalendarBoard({
  items,
  error,
  filters,
  onRange,
  colorOf,
  onOpen,
  onCreate,
  placeOf = (item) => item.channel_name,
  leading
}: {
  items: AgendaItem[]
  error: boolean
  filters: ReactNode
  onRange(start: Date, end: Date): void
  colorOf(item: AgendaItem): string
  onOpen(item: AgendaItem): void
  onCreate?: (day: Date) => void
  /** Where the item lives, in full rows and tooltips. */
  placeOf?(item: AgendaItem): string
  /** Goes before the item's title (the server's icon, in Home). */
  leading?(item: AgendaItem): ReactNode
}): ReactNode {
  const [view, setView] = useState<View>('month')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const days = useMemo(() => viewDays(view, view === 'list' ? startOfDay(new Date()) : anchor), [view, anchor])
  const today = startOfDay(new Date())

  useEffect(() => onRange(days[0], addDays(days[days.length - 1], 1)), [onRange, days])

  const chip = (item: AgendaItem, compact: boolean): ReactNode => (
    <ItemChip key={item.id} item={item} color={colorOf(item)} compact={compact} overdue={isOverdue(item, today)} onOpen={onOpen} place={placeOf(item)} leading={leading?.(item)} />
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-main">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 text-sm">
        <div className="w-56">
          <Segmented<View> options={VIEWS.map((value) => ({ value, label: t(`addons.calendar.views.${value}`) }))} value={view} onChange={setView} />
        </div>
        {view !== 'list' && (
          <div className="flex items-center gap-1">
            <button type="button" aria-label={t('addons.calendar.previous')} onClick={() => setAnchor((a) => shift(view, a, -1))} className="rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg">
              <ChevronLeft size={18} />
            </button>
            <button type="button" onClick={() => setAnchor(startOfDay(new Date()))} className="rounded-control border border-line px-2.5 py-1 font-medium hover:bg-elevated">
              {t('addons.calendar.today')}
            </button>
            <button type="button" aria-label={t('addons.calendar.next')} onClick={() => setAnchor((a) => shift(view, a, 1))} className="rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg">
              <ChevronRight size={18} />
            </button>
          </div>
        )}
        <h2 className="font-display text-base font-semibold first-letter:uppercase">{view === 'list' ? t('addons.calendar.next30') : viewTitle(view, anchor)}</h2>
        {error && <span className="text-danger">{t('addons.calendar.loadFailed')}</span>}
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-xs">
        {filters}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === 'list' ? (
          <ListView days={days} items={items} chip={chip} onCreate={onCreate} />
        ) : (
          <div className="grid min-h-full grid-cols-7 border-l border-line" style={{ gridAutoRows: view === 'month' ? 'minmax(96px, 1fr)' : 'minmax(320px, 1fr)' }}>
            {WEEKDAYS.map((d) => (
              <div key={d} className="sticky top-0 z-raised border-b border-r border-line bg-main px-2 py-1 text-xs font-semibold uppercase text-fg-subtle">
                {t(`addons.calendar.weekdays.${d}`)}
              </div>
            ))}
            {days.map((day) => (
              <DayCell
                key={ymd(day)}
                day={day}
                items={dayItems(items, day)}
                outside={view === 'month' && day.getMonth() !== anchor.getMonth()}
                today={ymd(day) === ymd(today)}
                limit={view === 'month' ? CELL_ITEMS : Infinity}
                chip={chip}
                onCreate={onCreate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DayCell({
  day,
  items,
  outside,
  today,
  limit,
  chip,
  onCreate
}: {
  day: Date
  items: AgendaItem[]
  outside: boolean
  today: boolean
  limit: number
  chip(item: AgendaItem, compact: boolean): ReactNode
  onCreate?: (day: Date) => void
}): ReactNode {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, limit)
  return (
    <div data-day={ymd(day)} className={`group flex min-w-0 flex-col gap-1 border-b border-r border-line p-1.5 ${outside ? 'bg-panel/40 text-fg-subtle' : ''}`}>
      <div className="flex items-center justify-between">
        <span className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${today ? 'bg-accent text-on-accent' : ''}`}>
          {day.getDate()}
        </span>
        {onCreate && !items.length && (
          <button
            type="button"
            aria-label={t('addons.calendar.createOn', { day: ymd(day) })}
            title={t('addons.calendar.create')}
            onClick={() => onCreate(day)}
            className="rounded-item p-0.5 text-fg-subtle opacity-0 hover:bg-elevated hover:text-fg focus:opacity-100 group-hover:opacity-100"
          >
            <CalendarPlus size={14} />
          </button>
        )}
      </div>
      {shown.map((item) => chip(item, true))}
      {items.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="text-left text-xs font-semibold text-fg-muted hover:text-fg">
          +{items.length - shown.length}
        </button>
      )}
    </div>
  )
}

function ListView({
  days,
  items,
  chip,
  onCreate
}: {
  days: Date[]
  items: AgendaItem[]
  chip(item: AgendaItem, compact: boolean): ReactNode
  onCreate?: (day: Date) => void
}): ReactNode {
  const withItems = days.map((day) => ({ day, items: dayItems(items, day) })).filter((d) => d.items.length)
  if (!withItems.length) {
    return (
      <div className="py-12 text-center text-sm text-fg-subtle">
        <p>{t('addons.calendar.empty30')}</p>
        {onCreate && (
          <button type="button" onClick={() => onCreate(days[0])} className="mt-2 font-semibold text-accent-text hover:underline">
            {t('addons.calendar.create')}
          </button>
        )}
      </div>
    )
  }
  return (
    <ul className="mx-auto max-w-[720px] space-y-4 p-4">
      {withItems.map(({ day, items: list }) => (
        <li key={ymd(day)}>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{dateFormat(LIST_DAY).format(day)}</h3>
          <div className="space-y-1">{list.map((item) => chip(item, false))}</div>
        </li>
      ))}
    </ul>
  )
}

function ItemChip({
  item,
  color,
  compact,
  overdue,
  onOpen,
  place,
  leading
}: {
  item: AgendaItem
  color: string
  compact: boolean
  overdue: boolean
  onOpen(item: AgendaItem): void
  place: string
  leading?: ReactNode
}): ReactNode {
  const time = item.starts_at ? dateFormat(TIME).format(new Date(item.starts_at)) : null
  const struck = item.done || item.cancelled
  const label = [time, item.title].filter(Boolean).join(' ')
  const title = `${label}${item.cancelled ? ' (cancelado)' : ''}${item.done ? ' (feito)' : ''}${overdue ? ' (atrasado)' : ''} · ${place}`
  return (
    <button
      type="button"
      title={title}
      onClick={() => onOpen(item)}
      style={overdue ? undefined : colorStyle(color)}
      className={`flex w-full min-w-0 items-center gap-1.5 rounded-item text-left font-medium hover:brightness-110 ${compact ? 'px-1.5 py-0.5 text-xs' : 'px-2.5 py-1.5 text-sm'} ${
        overdue ? 'bg-danger/15 text-danger ring-1 ring-danger/50' : ''
      } ${struck ? 'opacity-60' : ''}`}
    >
      {leading}
      {time && <span className="shrink-0 tabular-nums">{time}</span>}
      <span className={`min-w-0 truncate ${struck ? 'line-through' : ''}`}>{item.title}</span>
      {overdue && <span className="shrink-0 text-[10px] font-bold uppercase">{t('addons.calendar.overdue')}</span>}
      {!compact && <span className="ml-auto shrink-0 text-xs opacity-75">{place}</span>}
    </button>
  )
}
