import { X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { CalendarBoard, FilterChip, OnlyMine } from '../addons/calendar/CalendarPanel'
import { addDays, dayItems, onDay, sourceColors, startOfDay, viewDays, viewTitle, ymd } from '../addons/calendar/dates'
import { HOME_FULL, HOME_MINI, useCalendar } from '../addons/calendar/store'
import type { AgendaItem } from '../lib/api'
import { useChat } from '../store/chat'
import { useNav } from '../store/nav'
import { ServerIcon } from './ui'
import { dateFormat } from '../lib/format'
import { t } from '../lib/i18n'

const NEXT_DAYS = 7
const WEEKDAYS = ['d', 's', 't', 'q', 'q', 's', 's']
const NO_ITEMS: AgendaItem[] = []

const TIME = { hour: '2-digit', minute: '2-digit' } as const
const DAY = { weekday: 'short', day: 'numeric' } as const

const openItem = (item: AgendaItem): void => useNav.getState().openAddonItem(item.server_id, item.channel_id, item.item_id)

/** The servers among `items`, in a stable order, so each keeps its color. */
function serversOf(items: AgendaItem[]): { id: string; name: string }[] {
  const byId = new Map(items.map((i) => [i.server_id, i.server_name]))
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

function ServerMark({ id, name, size = 14 }: { id: string; name: string; size?: number }): ReactNode {
  const url = useChat((s) => s.servers[id]?.icon_url)
  return <ServerIcon name={name} url={url} size={size} />
}

/** The hub's side card: this month with a dot on the days with items, and the next 7 days. */
export function HomeCalendarCard({ expanded, onExpand }: { expanded: boolean; onExpand(): void }): ReactNode {
  const today = startOfDay(new Date())
  const key = ymd(today)
  const days = useMemo(() => viewDays('month', new Date(key + 'T12:00:00')), [key])
  const items = useCalendar((s) => s.views[HOME_MINI]?.items ?? NO_ITEMS)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const first = new Date(key + 'T00:00:00')
    // The grid doesn't always reach the end of the next 7 days.
    const lastGridDay = addDays(days[days.length - 1], 1)
    const lastNextDay = addDays(first, NEXT_DAYS)
    const end = lastGridDay > lastNextDay ? lastGridDay : lastNextDay
    useCalendar.getState().loadHome(HOME_MINI, days[0], end).catch(() => setFailed(true))
    return () => useCalendar.getState().drop(HOME_MINI)
  }, [key, days])

  const nextDays = Array.from({ length: NEXT_DAYS }, (_, i) => addDays(today, i))
  const upcoming = nextDays.flatMap((day) => dayItems(items, day).map((item) => ({ day, item })))

  return (
    <section aria-label={t('home.calendar.title')} className="rounded-panel border border-line bg-panel p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-display font-semibold first-letter:uppercase">{viewTitle('month', today)}</h2>
        {!expanded && (
          <button type="button" onClick={onExpand} className="shrink-0 text-sm font-semibold text-accent-text hover:underline">
            {t('home.calendar.open')}
          </button>
        )}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-xs">
        {WEEKDAYS.map((d, i) => (
          <span key={i} aria-hidden className="pb-1 font-semibold uppercase text-fg-subtle">
            {d}
          </span>
        ))}
        {days.map((day) => {
          const marked = items.some((item) => onDay(item, day))
          const current = ymd(day) === key
          return (
            <span
              key={ymd(day)}
              data-day={ymd(day)}
              data-marked={marked || undefined}
              className={`relative mx-auto flex h-6 w-6 items-center justify-center rounded-full ${current ? 'bg-accent font-semibold text-on-accent' : day.getMonth() === today.getMonth() ? '' : 'text-fg-subtle'}`}
            >
              {day.getDate()}
              {marked && <span aria-hidden className={`absolute bottom-0 h-1 w-1 rounded-full ${current ? 'bg-on-accent' : 'bg-accent'}`} />}
            </span>
          )
        })}
      </div>
      <div className="mt-3 border-t border-line pt-3">
        {failed ? (
          <p className="text-sm text-danger">{t('home.calendar.failed')}</p>
        ) : upcoming.length === 0 ? (
          <p className="text-sm text-fg-subtle">{t('home.calendar.empty')}</p>
        ) : (
          <ul className="space-y-1">
            {upcoming.map(({ day, item }) => (
              <li key={`${ymd(day)}:${item.id}`}>
                <button
                  type="button"
                  onClick={() => openItem(item)}
                  title={`${item.title} · ${item.server_name} · ${item.channel_name}`}
                  className="flex w-full min-w-0 items-center gap-2 rounded-item px-1.5 py-1 text-left text-sm hover:bg-elevated"
                >
                  <ServerMark id={item.server_id} name={item.server_name} />
                  <span className="min-w-0 flex-1 truncate">
                    {item.title}
                  </span>
                  <span className="shrink-0 text-xs text-fg-subtle">
                    {dateFormat(DAY).format(day)}
                    {item.starts_at && ` · ${dateFormat(TIME).format(new Date(item.starts_at))}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/** The whole calendar inside Home: every server's items, with the addon's own views. */
export function HomeCalendar({ onClose }: { onClose(): void }): ReactNode {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [onlyMine, setOnlyMine] = useState(false)
  const [error, setError] = useState(false)
  const all = useCalendar((s) => s.views[HOME_FULL]?.items ?? NO_ITEMS)
  const loaded = useCalendar((s) => !!s.views[HOME_FULL])

  const load = useCallback((start: Date, end: Date) => {
    setError(false)
    useCalendar.getState().loadHome(HOME_FULL, start, end).catch(() => setError(true))
  }, [])
  useEffect(() => () => useCalendar.getState().drop(HOME_FULL), [])

  const servers = useMemo(() => serversOf(all), [all])
  const colors = useMemo(() => sourceColors(servers.map((s) => s.id)), [servers])
  const items = all.filter((i) => !hidden.has(i.server_id) && (!onlyMine || i.mine))
  const toggle = (id: string): void =>
    setHidden((h) => {
      const next = new Set(h)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <section aria-label={t('home.calendar.all')} className="relative flex h-[640px] min-h-0 flex-col overflow-hidden rounded-panel border border-line">
      <button
        type="button"
        title={t('home.calendar.close')}
        aria-label={t('home.calendar.close')}
        onClick={onClose}
        className="absolute right-2 top-2 z-drawer rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg"
      >
        <X size={18} />
      </button>
      <CalendarBoard
        items={items}
        error={error}
        onRange={load}
        colorOf={(item) => colors[item.server_id] ?? 'gray'}
        onOpen={openItem}
        placeOf={(item) => `${item.server_name} · ${item.channel_name}`}
        leading={(item) => <ServerMark id={item.server_id} name={item.server_name} />}
        filters={
          <>
            {servers.map((server) => (
              <FilterChip
                key={server.id}
                on={!hidden.has(server.id)}
                color={colors[server.id]}
                label={
                  <>
                    <ServerMark id={server.id} name={server.name} />
                    {server.name}
                  </>
                }
                onToggle={() => toggle(server.id)}
              />
            ))}
            {!servers.length && loaded && <span className="text-fg-subtle">{t('home.calendar.nothing')}</span>}
            <OnlyMine checked={onlyMine} onChange={setOnlyMine} />
          </>
        }
      />
    </section>
  )
}
