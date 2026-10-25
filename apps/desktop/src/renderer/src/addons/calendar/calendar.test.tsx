import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type AgendaItem, type Channel, type Me, type ServerDetail } from '../../lib/api'
import { useNav } from '../../store/nav'
import { dispatchAddonEvent } from '../registry'
import { CalendarPanel } from './CalendarPanel'
import { dayItems, isOverdue, onDay, shift, sourceColors, viewDays, ymd } from './dates'
import { useCalendar } from './store'

vi.mock('../../lib/api', async (original) => ({ ...(await original<object>()), api: vi.fn() }))

const server = {
  id: 's1',
  owner_id: 'u1',
  roles: [],
  members: [],
  channels: [
    { id: 'ev', type: 'addon', addon_key: 'events', name: 'Eventos', overrides: [] },
    { id: 'kb', type: 'addon', addon_key: 'kanban', name: 'Sprint', overrides: [] }
  ]
} as unknown as ServerDetail
const channel = { id: 'cal', type: 'addon', addon_key: 'calendar', name: 'Calendário' } as unknown as Channel
const me = { id: 'u1' } as Me

const today = new Date()
const at = (dayOffset: number, hour: number): string => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, hour)
  return d.toISOString()
}
const dayOf = (offset: number): string => ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset))

const item = (id: string, extra: Partial<AgendaItem>): AgendaItem => ({
  id,
  workspace_id: 'ev',
  item_id: `i-${id}`,
  title: id,
  kind: 'event',
  all_day: false,
  day: null,
  starts_at: at(0, 20),
  ends_at: at(0, 22),
  color: null,
  done: false,
  cancelled: false,
  mine: false,
  addon_key: 'events',
  server_id: 's1',
  server_name: 'Squad',
  channel_id: 'ev',
  channel_name: 'Eventos',
  ...extra
})

const SOURCES = [
  { channel_id: 'ev', channel_name: 'Eventos', addon_key: 'events' },
  { channel_id: 'kb', channel_name: 'Sprint', addon_key: 'kanban' }
]

function show(items: AgendaItem[]): void {
  vi.mocked(api).mockResolvedValue({ items, sources: SOURCES })
  render(<CalendarPanel server={server} channel={channel} me={me} perms={0} />)
}

beforeEach(() => {
  useCalendar.setState({ views: {} })
  vi.mocked(api).mockReset()
})
afterEach(cleanup)

describe('calendar dates', () => {
  it('lays a month out in six weeks from Sunday', () => {
    const days = viewDays('month', new Date(2026, 9, 25))
    expect(days).toHaveLength(42)
    expect(ymd(days[0])).toBe('2026-09-27')
    expect(days[0].getDay()).toBe(0)
    expect(ymd(viewDays('week', new Date(2026, 9, 28))[0])).toBe('2026-10-25')
    expect(ymd(shift('month', new Date(2026, 9, 25), 1))).toBe('2026-11-01')
    expect(viewDays('list', new Date(2026, 9, 25))).toHaveLength(30)
  })

  it('places items on their days', () => {
    const lateNight = item('festa', { starts_at: new Date(2026, 9, 25, 23).toISOString(), ends_at: new Date(2026, 9, 26, 2).toISOString() })
    expect(onDay(lateNight, new Date(2026, 9, 25))).toBe(true)
    expect(onDay(lateNight, new Date(2026, 9, 26))).toBe(true)
    expect(onDay(lateNight, new Date(2026, 9, 27))).toBe(false)
    const card = item('card', { all_day: true, day: '2026-10-27', starts_at: null, ends_at: null })
    expect(onDay(card, new Date(2026, 9, 27))).toBe(true)
    expect(dayItems([lateNight, card], new Date(2026, 9, 27)).map((i) => i.id)).toEqual(['card'])
    expect(isOverdue(card, new Date(2026, 9, 28))).toBe(true)
    expect(isOverdue({ ...card, done: true }, new Date(2026, 9, 28))).toBe(false)
    expect(isOverdue(card, new Date(2026, 9, 27))).toBe(false)
    expect(sourceColors(['a', 'b'])).toEqual({ a: 'blue', b: 'green' })
  })
})

describe('calendar panel', () => {
  const card = item('Entrega', { kind: 'card', all_day: true, day: dayOf(0), starts_at: null, ends_at: null, channel_id: 'kb', channel_name: 'Sprint', mine: true })
  const late = item('Atrasada', { kind: 'card', all_day: true, day: dayOf(-1), starts_at: null, ends_at: null, channel_id: 'kb', channel_name: 'Sprint' })
  const event = item('Noite de jogos', {})

  it('shows events and due dates on their days, and opens them in their addon', async () => {
    show([card, event, late])
    const cell = (await screen.findByText('Entrega')).closest('[data-day]') as HTMLElement
    expect(cell.dataset.day).toBe(dayOf(0))
    expect(within(cell).getByText('Noite de jogos')).toBeTruthy()
    expect(screen.getByText('atrasado')).toBeTruthy()
    const openAddonItem = vi.spyOn(useNav.getState(), 'openAddonItem').mockImplementation(() => {})
    fireEvent.click(screen.getByText('Entrega'))
    expect(openAddonItem).toHaveBeenCalledWith('s1', 'kb', 'i-Entrega')
  })

  it('filters by source and by mine', async () => {
    show([card, event])
    await screen.findByText('Entrega')
    fireEvent.click(screen.getByRole('button', { name: 'Kanban' }))
    expect(screen.queryByText('Entrega')).toBeNull()
    expect(screen.getByText('Noite de jogos')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Kanban' }))
    fireEvent.click(screen.getByLabelText('Só meus'))
    expect(screen.getByText('Entrega')).toBeTruthy()
    expect(screen.queryByText('Noite de jogos')).toBeNull()
  })

  it('starts an event on an empty day', async () => {
    show([])
    const openAddonItem = vi.spyOn(useNav.getState(), 'openAddonItem').mockImplementation(() => {})
    fireEvent.click(await screen.findByLabelText(`Criar evento em ${dayOf(1)}`))
    expect(openAddonItem).toHaveBeenCalledWith('s1', 'ev', `new:${dayOf(1)}`)
  })

  it('lists the next 30 days', async () => {
    show([event])
    fireEvent.click(await screen.findByText('Lista'))
    expect(await screen.findByText('Próximos 30 dias')).toBeTruthy()
    expect(screen.getByText('Noite de jogos')).toBeTruthy()
  })

  it('reloads when a due date changes elsewhere', async () => {
    show([card])
    await screen.findByText('Entrega')
    vi.useFakeTimers()
    try {
      vi.mocked(api).mockClear()
      dispatchAddonEvent({ type: 'addon.kanban.card.updated', data: { channel_id: 'kb' } })
      dispatchAddonEvent({ type: 'addon.whiteboard.pointer', data: {} })
      await vi.advanceTimersByTimeAsync(500)
      expect(api).toHaveBeenCalledTimes(1)
      expect(vi.mocked(api).mock.calls[0][0]).toMatch(/^\/addons\/calendar\/channels\/cal\/items\?/)
    } finally {
      vi.useRealTimers()
    }
  })
})
