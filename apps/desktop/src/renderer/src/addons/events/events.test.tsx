import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type AgendaItem, type Channel, type Me, type ServerDetail } from '../../lib/api'
import { pendingItems } from '../../store/home'
import { countLabel, dayLabel, whenLabel } from './bits'
import { defaultStart, toLocalInput } from './EventModal'
import { EventsPanel } from './EventsPanel'
import { myAnswer, splitEvents, useEvents, type EventItem } from './store'
import { EventsSummary } from './Summary'

vi.mock('../../lib/api', async (original) => ({ ...(await original<object>()), api: vi.fn(), fetchMedia: vi.fn(() => new Promise(() => {})) }))

const server = {
  id: 's1',
  owner_id: 'u9',
  roles: [],
  channels: [{ id: 'v1', type: 'voice', name: 'Sala 1', overrides: [] }],
  members: [
    { user: { id: 'u1', display_name: 'Ana' }, nickname: null, role_ids: [] },
    { user: { id: 'u2', display_name: 'Bia' }, nickname: null, role_ids: [] }
  ]
} as unknown as ServerDetail
const channel = { id: 'c1', type: 'addon', addon_key: 'events', name: 'Eventos' } as unknown as Channel
const me = { id: 'u1' } as Me

const inHours = (h: number): string => new Date(Date.now() + h * 3_600_000).toISOString()

const event = (id: string, extra: Partial<EventItem> = {}): EventItem => ({
  id,
  title: `Evento ${id}`,
  description: '',
  starts_at: inHours(48),
  ends_at: inHours(50),
  timezone: 'America/Sao_Paulo',
  repeat: 'none',
  location_channel_id: null,
  location_text: null,
  cover: null,
  created_by: 'u9',
  created_at: inHours(-1),
  updated_at: inHours(-1),
  cancelled_at: null,
  occurrence: { index: 0, starts_at: extra.starts_at ?? inHours(48), ends_at: extra.ends_at ?? inHours(50) },
  over: false,
  responses: { going: ['u2'], maybe: [], no: [] },
  ...extra
})

function show(events: EventItem[], canManage = false, openItem: string | null = null): void {
  vi.mocked(api).mockResolvedValue({ events, can_manage: canManage })
  render(<EventsPanel server={server} channel={channel} me={me} perms={0} openItem={openItem} onItemOpened={() => {}} />)
}

beforeEach(() => {
  useEvents.setState({ lists: {} })
  vi.mocked(api).mockReset()
})
afterEach(cleanup)

describe('event helpers', () => {
  it('splits coming up from past and finds my answer', () => {
    const later = event('b', { occurrence: { index: 0, starts_at: inHours(72), ends_at: inHours(73) } })
    const soon = event('a', { occurrence: { index: 0, starts_at: inHours(2), ends_at: inHours(3) } })
    const past = event('c', { over: true })
    const { upcoming, past: done } = splitEvents([later, past, soon])
    expect(upcoming.map((e) => e.id)).toEqual(['a', 'b'])
    expect(done.map((e) => e.id)).toEqual(['c'])
    expect(myAnswer(soon, 'u2')).toBe('going')
    expect(myAnswer(soon, 'u1')).toBeNull()
    expect(countLabel(event('d', { responses: { going: ['u1', 'u2'], maybe: ['u3'], no: [] } }))).toBe('2 vão · 1 talvez')
  })

  it('writes days and times in the user zone', () => {
    const now = new Date(2026, 9, 25, 15, 0)
    expect(dayLabel(new Date(2026, 9, 25, 20, 0), now)).toBe('hoje')
    expect(dayLabel(new Date(2026, 9, 26, 9, 0), now)).toBe('amanhã')
    expect(whenLabel(new Date(2026, 9, 25, 20, 0).toISOString(), new Date(2026, 9, 25, 22, 30).toISOString(), now)).toBe('hoje · 20:00–22:30')
    expect(defaultStart('2026-11-27')).toEqual(new Date(2026, 10, 27, 20, 0))
    expect(defaultStart(null, new Date(2026, 9, 25, 15, 40))).toEqual(new Date(2026, 9, 25, 16, 0))
    expect(toLocalInput(new Date(2026, 0, 5, 9, 7))).toBe('2026-01-05T09:07')
  })

  it('puts today\'s events of mine first in "Pra você ver"', () => {
    const item = (id: string, startsIn: number, endsIn: number): AgendaItem =>
      ({ id, kind: 'event', title: id, starts_at: inHours(startsIn), ends_at: inHours(endsIn), item_id: id }) as unknown as AgendaItem
    const items = pendingItems({
      mentions: [],
      dmPreviews: {},
      servers: {},
      reads: {},
      dms: {},
      friends: { f: { kind: 'incoming', since: inHours(-1), user: { id: 'f' } } } as never,
      missed: [],
      muted: [],
      events: [item('later', 5, 6), item('over', -3, -2), item('now', -1, 1)]
    })
    expect(items.map((i) => i.key)).toEqual(['e:now', 'e:later', 'f:f'])
  })
})

describe('events panel', () => {
  it('lists events and answers Vou', async () => {
    show([event('e1', { location_channel_id: 'v1', repeat: 'weekly' })])
    expect(await screen.findByText('Evento e1')).toBeTruthy()
    expect(screen.getByText('Sala 1')).toBeTruthy()
    expect(screen.getByText('Toda semana')).toBeTruthy()
    expect(screen.getByText('1 vai')).toBeTruthy()
    expect(screen.queryByText('Criar evento')).toBeNull()

    vi.mocked(api).mockResolvedValueOnce(event('e1', { responses: { going: ['u2', 'u1'], maybe: [], no: [] } }))
    fireEvent.click(screen.getByText('Vou'))
    await waitFor(() => expect(screen.getByText('2 vão')).toBeTruthy())
    expect(api).toHaveBeenCalledWith('/addons/events/channels/c1/events/e1/response', { method: 'PUT', body: { status: 'going' } })
    expect(screen.getByText('Vou').getAttribute('aria-pressed')).toBe('true')
  })

  it('shows who answered', async () => {
    show([event('e1')])
    fireEvent.click(await screen.findByText('1 vai'))
    expect(screen.getByText('Bia')).toBeTruthy()
  })

  it('keeps cancelled and past events apart, without answers', async () => {
    show([event('e1', { cancelled_at: inHours(-1) }), event('e2', { over: true })])
    expect(await screen.findByText('Cancelado')).toBeTruthy()
    expect(screen.queryByText('Vou')).toBeNull()
    expect(screen.queryByText('Evento e2')).toBeNull()
    fireEvent.click(screen.getByText(/Anteriores \(1\)/))
    expect(screen.getByText('Evento e2')).toBeTruthy()
  })

  it('creates an event on a picked day', async () => {
    show([], true, 'new:2026-11-27')
    expect(await screen.findByRole('dialog', { name: 'Criar evento' })).toBeTruthy()
    expect((screen.getByLabelText('Começa') as HTMLInputElement).value).toBe('2026-11-27T20:00')
    expect((screen.getByLabelText('Termina') as HTMLInputElement).value).toBe('2026-11-27T22:00')
    fireEvent.change(screen.getByPlaceholderText('Noite de jogos'), { target: { value: 'Churrasco' } })
    fireEvent.click(screen.getByText('Outro lugar'))
    fireEvent.change(screen.getByLabelText('Lugar'), { target: { value: 'Casa da Ana' } })
    vi.mocked(api).mockResolvedValueOnce(event('e9', { title: 'Churrasco' }))
    await act(async () => {
      fireEvent.click(screen.getByText('Criar evento', { selector: 'button[type="submit"]' }))
    })
    const [, call] = vi.mocked(api).mock.calls.at(-1)!
    expect(call).toMatchObject({
      method: 'POST',
      body: {
        title: 'Churrasco',
        starts_at: new Date(2026, 10, 27, 20, 0).toISOString(),
        ends_at: new Date(2026, 10, 27, 22, 0).toISOString(),
        repeat: 'none',
        location_channel_id: null,
        location_text: 'Casa da Ana'
      }
    })
    expect(await screen.findByText('Churrasco')).toBeTruthy()
  })
})

describe('events summary', () => {
  it('shows the next events, skipping cancelled ones', async () => {
    vi.mocked(api).mockResolvedValue({ events: [event('e1'), event('e2', { cancelled_at: inHours(-1) })], can_manage: false })
    render(<EventsSummary server={server} channel={channel} me={me} perms={0} />)
    expect(await screen.findByText('Evento e1')).toBeTruthy()
    expect(screen.getByText('Próximos eventos')).toBeTruthy()
    expect(screen.queryByText('Evento e2')).toBeNull()
  })
})
