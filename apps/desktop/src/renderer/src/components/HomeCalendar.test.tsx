/** Home's calendar: every server's dates in one place, through GET /users/me/agenda. */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addDays, startOfDay, ymd } from '../addons/calendar/dates'
import { useCalendar } from '../addons/calendar/store'
import { api, type AgendaItem } from '../lib/api'
import { useNav } from '../store/nav'
import { HomeCalendar, HomeCalendarCard } from './HomeCalendar'

vi.mock('../lib/api', async (original) => ({ ...(await original<object>()), api: vi.fn() }))

const today = startOfDay(new Date())
const day = (offset: number): string => ymd(addDays(today, offset))

const item = (id: string, server: 'a' | 'b', extra: Partial<AgendaItem> = {}): AgendaItem => ({
  id,
  workspace_id: `w${server}`,
  item_id: `i-${id}`,
  title: id,
  kind: 'card',
  all_day: true,
  day: day(0),
  starts_at: null,
  ends_at: null,
  color: null,
  done: false,
  cancelled: false,
  mine: false,
  addon_key: 'kanban',
  server_id: `s-${server}`,
  server_name: server === 'a' ? 'Squad' : 'Trabalho',
  channel_id: `c-${server}`,
  channel_name: 'Sprint',
  ...extra
})

const ITEMS = [item('Entrega', 'a', { mine: true }), item('Reunião', 'b', { day: day(2) }), item('Depois', 'b', { day: day(9) })]

beforeEach(() => {
  useCalendar.setState({ views: {} })
  vi.mocked(api).mockReset()
  vi.mocked(api).mockResolvedValue(ITEMS)
})

describe('the card in the hub', () => {
  it('lists the next 7 days of all servers and marks the days with items', async () => {
    render(<HomeCalendarCard expanded={false} onExpand={() => {}} />)
    expect(await screen.findByText('Entrega')).toBeTruthy()
    expect(screen.getByText('Reunião')).toBeTruthy()
    expect(screen.queryByText('Depois')).toBeNull()
    const cell = document.querySelector(`[data-day="${day(0)}"]`) as HTMLElement
    expect(cell.dataset.marked).toBe('true')
    expect(String(vi.mocked(api).mock.calls[0][0])).toContain('/users/me/agenda')
  })

  it('says when nothing is coming', async () => {
    vi.mocked(api).mockResolvedValue([])
    render(<HomeCalendarCard expanded={false} onExpand={() => {}} />)
    expect(await screen.findByText('Nada marcado nos próximos 7 dias.')).toBeTruthy()
  })

  it('opens an item where it lives', async () => {
    const openAddonItem = vi.spyOn(useNav.getState(), 'openAddonItem').mockImplementation(() => {})
    render(<HomeCalendarCard expanded={false} onExpand={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Reunião/ }))
    expect(openAddonItem).toHaveBeenCalledWith('s-b', 'c-b', 'i-Reunião')
  })

  it('expands into the full calendar', async () => {
    const onExpand = vi.fn()
    render(<HomeCalendarCard expanded={false} onExpand={onExpand} />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir calendário' }))
    expect(onExpand).toHaveBeenCalled()
    await screen.findByText('Entrega')
  })
})

describe('the full calendar', () => {
  const shows = (title: string): boolean => screen.queryByText(title) !== null
  const filter = (name: RegExp): HTMLElement => screen.getByRole('button', { name, pressed: true })

  it('joins the servers, with a filter for each', async () => {
    render(<HomeCalendar onClose={() => {}} />)
    await screen.findByText('Entrega')
    expect(shows('Reunião')).toBe(true)
    fireEvent.click(filter(/Trabalho/))
    expect(shows('Reunião')).toBe(false)
    expect(shows('Entrega')).toBe(true)
  })

  it('keeps only my items with "Só meus"', async () => {
    render(<HomeCalendar onClose={() => {}} />)
    await screen.findByText('Reunião')
    fireEvent.click(screen.getByLabelText('Só meus'))
    expect(shows('Reunião')).toBe(false)
    expect(shows('Entrega')).toBe(true)
  })

  it('names the server in each item', async () => {
    render(<HomeCalendar onClose={() => {}} />)
    const chip = (await screen.findByText('Entrega')).closest('button') as HTMLElement
    expect(chip.title).toContain('Squad · Sprint')
    expect(within(chip).getByText('Entrega')).toBeTruthy()
  })

  it('follows changes in any server, by asking the API again', async () => {
    render(<HomeCalendar onClose={() => {}} />)
    await screen.findByText('Entrega')
    vi.mocked(api).mockClear()
    vi.mocked(api).mockResolvedValue([item('Nova', 'a')])
    act(() => useCalendar.getState().onEvent('addon.kanban.card.updated'))
    expect(await screen.findByText('Nova', {}, { timeout: 1500 })).toBeTruthy()
    expect(String(vi.mocked(api).mock.calls[0][0])).toContain('/users/me/agenda')
  })

  it('ignores events that cannot move a date', async () => {
    render(<HomeCalendar onClose={() => {}} />)
    await screen.findByText('Entrega')
    vi.mocked(api).mockClear()
    act(() => useCalendar.getState().onEvent('addon.polls.poll.updated'))
    await new Promise((resolve) => setTimeout(resolve, 500))
    await waitFor(() => expect(api).not.toHaveBeenCalled())
  })

  it('leaves nothing to refresh once closed', async () => {
    const { unmount } = render(<HomeCalendar onClose={() => {}} />)
    await screen.findByText('Entrega')
    unmount()
    expect(useCalendar.getState().views).toEqual({})
  })
})
