import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type Channel, type Me, type Message } from '../../lib/api'
import { CreatePollModal } from './CreatePollModal'
import { PollCard, timeLeft } from './PollCard'
import { isClosed, leaders, nextVotes, percent, usePolls, type Poll } from './store'

vi.mock('../../lib/api', async (original) => ({ ...(await original<object>()), api: vi.fn() }))

const channel = { id: 'c1', type: 'text', name: 'geral', server_id: 's1' } as unknown as Channel
const me = { id: 'u1' } as Me
const message = { id: 7, channel_id: 'c1', embed: { addon_key: 'polls', id: 'p1' } } as unknown as Message

const poll = (extra: Partial<Poll> = {}): Poll => ({
  id: 'p1',
  channel_id: 'c1',
  message_id: 7,
  question: 'Jantar?',
  options: [
    { id: 'o1', text: 'Pizza', emoji: '🍕', votes: 2, voter_ids: ['u2', 'u3'] },
    { id: 'o2', text: 'Sushi', emoji: null, votes: 1, voter_ids: ['u1'] }
  ],
  multiple: false,
  anonymous: false,
  closes_at: null,
  closed_at: null,
  closed: false,
  total_voters: 3,
  created_by: 'u2',
  my_votes: ['o2'],
  ...extra
})

function show(p: Poll, canModerate = false): void {
  usePolls.setState({ polls: { [p.id]: p }, requested: { [p.id]: true } })
  render(
    <PollCard
      message={message}
      channel={channel}
      me={me}
      canModerate={canModerate}
      userOf={() => undefined}
      nameOf={(id) => ({ u1: 'Ana', u2: 'Bia', u3: 'Caio' })[id] ?? 'Alguém'}
    />
  )
}

beforeEach(() => {
  usePolls.setState({ polls: {}, requested: {} })
  vi.mocked(api).mockReset()
})
afterEach(cleanup)

describe('poll rules', () => {
  it('picks, switches and takes back a single vote', () => {
    const p = poll()
    expect(nextVotes(p, 'o1')).toEqual(['o1'])
    expect(nextVotes(p, 'o2')).toEqual([])
    const multi = poll({ multiple: true })
    expect(nextVotes(multi, 'o1')).toEqual(['o2', 'o1'])
    expect(nextVotes(multi, 'o2')).toEqual([])
  })

  it('counts percent of voters and finds the leaders', () => {
    const p = poll()
    expect(p.options.map((o) => percent(p, o))).toEqual([67, 33])
    expect([...leaders(p)]).toEqual(['o1'])
    const tie = poll({ options: p.options.map((o) => ({ ...o, votes: 1 })) })
    expect(leaders(tie).size).toBe(2)
    expect(leaders(poll({ options: p.options.map((o) => ({ ...o, votes: 0 })), total_voters: 0 })).size).toBe(0)
  })

  it('is closed by hand or once the deadline passes', () => {
    const now = new Date('2026-10-25T15:00:00Z').getTime()
    expect(isClosed(poll({ closes_at: '2026-10-25T14:59:00Z' }), now)).toBe(true)
    expect(isClosed(poll({ closes_at: '2026-10-25T16:00:00Z' }), now)).toBe(false)
    expect(isClosed(poll({ closed: true }), now)).toBe(true)
    expect(timeLeft('2026-10-25T15:20:00Z', now)).toBe('Encerra em 20 min')
    expect(timeLeft('2026-10-25T23:00:00Z', now)).toBe('Encerra em 8 h')
    expect(timeLeft('2026-10-28T15:00:00Z', now)).toBe('Encerra em 3 dias')
  })

  it('keeps my own votes when counts arrive live', () => {
    usePolls.setState({ polls: { p1: poll() }, requested: { p1: true } })
    const { my_votes: _, ...counts } = poll({ total_voters: 4 })
    usePolls.getState().apply('addon.polls.updated', counts as unknown as Record<string, unknown>)
    expect(usePolls.getState().polls.p1.total_voters).toBe(4)
    expect(usePolls.getState().polls.p1.my_votes).toEqual(['o2'])
    usePolls.getState().apply('addon.polls.voted', { id: 'p1', my_votes: ['o1'] })
    expect(usePolls.getState().polls.p1.my_votes).toEqual(['o1'])
  })
})

describe('poll card', () => {
  it('shows the options with their share and votes for one', async () => {
    show(poll())
    expect(screen.getByText('Jantar?')).toBeTruthy()
    expect(screen.getByText('67% · 2')).toBeTruthy()
    expect(screen.getByText('3 votos')).toBeTruthy()
    expect(screen.queryByText('Encerrar enquete')).toBeNull()

    vi.mocked(api).mockResolvedValueOnce(poll({ my_votes: ['o1'] }))
    fireEvent.click(screen.getByText('Pizza'))
    await waitFor(() => expect(usePolls.getState().polls.p1.my_votes).toEqual(['o1']))
    expect(api).toHaveBeenCalledWith('/addons/polls/channels/c1/polls/p1/vote', { method: 'PUT', body: { option_ids: ['o1'] } })
  })

  it('lists who voted, unless it is anonymous', () => {
    show(poll())
    fireEvent.click(screen.getByText('Ver votos'))
    expect(screen.getByText('Bia')).toBeTruthy()
    expect(screen.getByText('Caio')).toBeTruthy()
    cleanup()
    show(poll({ anonymous: true, options: poll().options.map((o) => ({ ...o, voter_ids: null })) }))
    expect(screen.queryByText('Ver votos')).toBeNull()
    expect(screen.getByText(/anônima/)).toBeTruthy()
  })

  it('lets a moderator close it, and a closed poll takes no votes', async () => {
    show(poll(), true)
    vi.mocked(api).mockResolvedValueOnce(poll({ closed: true, closed_at: '2026-10-25T15:00:00Z' }))
    fireEvent.click(screen.getByText('Encerrar enquete'))
    await waitFor(() => expect(screen.getByText('Resultado final')).toBeTruthy())
    expect(screen.getByText('Encerrada')).toBeTruthy()
    expect((screen.getByText('Pizza').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('fetches a poll it does not have yet', async () => {
    vi.mocked(api).mockResolvedValue([poll()])
    render(<PollCard message={message} channel={channel} me={me} canModerate={false} userOf={() => undefined} nameOf={() => ''} />)
    expect(screen.getByText('Carregando enquete…')).toBeTruthy()
    expect(await screen.findByText('Jantar?')).toBeTruthy()
    expect(api).toHaveBeenCalledWith('/addons/polls/channels/c1/polls?ids=p1')
  })
})

describe('create poll', () => {
  it('checks the form and sends the poll', async () => {
    const onClose = vi.fn()
    render(<CreatePollModal channel={channel} onClose={onClose} />)
    fireEvent.click(screen.getByText('Criar enquete', { selector: 'button' }))
    expect(screen.getByRole('alert').textContent).toBe('Escreva a pergunta.')

    fireEvent.change(screen.getByPlaceholderText('O que vocês acham?'), { target: { value: ' Jantar? ' } })
    fireEvent.change(screen.getByLabelText('Opção 1'), { target: { value: 'Pizza' } })
    fireEvent.change(screen.getByLabelText('Opção 2'), { target: { value: 'pizza' } })
    fireEvent.click(screen.getByText('Criar enquete', { selector: 'button' }))
    expect(screen.getByRole('alert').textContent).toBe('As opções precisam ser diferentes.')

    fireEvent.change(screen.getByLabelText('Opção 2'), { target: { value: 'Sushi' } })
    fireEvent.change(screen.getByLabelText('Emoji da opção 1'), { target: { value: '🍕' } })
    fireEvent.click(screen.getByText('Adicionar opção'))
    fireEvent.click(screen.getByText('Várias respostas'))
    vi.mocked(api).mockResolvedValueOnce(poll())
    await act(async () => {
      fireEvent.click(screen.getByText('Criar enquete', { selector: 'button' }))
    })
    expect(api).toHaveBeenCalledWith('/addons/polls/channels/c1/polls', {
      method: 'POST',
      body: {
        question: 'Jantar?',
        options: [
          { text: 'Pizza', emoji: '🍕' },
          { text: 'Sushi', emoji: null }
        ],
        multiple: true,
        anonymous: false,
        duration: '24h'
      }
    })
    expect(onClose).toHaveBeenCalled()
  })
})
