/** Block 4.2.10 follow-up: the "Jogos do dia" page from Home's sidebar, and "Ver jogo". */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../../lib/api'
import type { Me } from '../../lib/api'
import type { DailySummary } from '../../lib/daily'
import { useChat } from '../../store/chat'
import { useDaily } from '../../store/daily'
import { useNav } from '../../store/nav'
import { useSocial } from '../../store/social'
import { DailyGameModal } from './DailyGameModal'
import { DailyGamesPage } from './DailyGamesPage'

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))
const ME = { id: 'me', username: 'me', display_name: 'Eu', avatar_url: null, badges: [], email: 'me@example.com' } as unknown as Me
const DAY = '2026-11-22'
const SUMMARY: DailySummary = {
  day: DAY,
  games: ['sudoku', 'trilha', 'cacapalavras'],
  results: [{ game: 'trilha', day: DAY, time_ms: 95_000, attempts: 1, completed: true }],
  streak: 4,
  friends_today: [],
  rankings: { trilha: [{ user_id: 'me', time_ms: 95_000, attempts: 1 }] }
}

beforeEach(() => {
  vi.spyOn(api, 'api').mockImplementation(async (path) => (path === '/daily' ? SUMMARY : []))
  useChat.setState({ meId: 'me' })
  useSocial.setState({ friends: {} })
  useDaily.setState({ summary: null, failed: false })
})

describe('Jogos do dia page', () => {
  it('lists every game with its state and the streak', async () => {
    render(<DailyGamesPage />)
    expect(await screen.findByText('4 dias seguidos')).toBeTruthy()
    const trilha = screen.getByRole('article', { name: 'Trilha' })
    expect(within(trilha).getByText(/Feito em 1:35/)).toBeTruthy()
    expect(within(trilha).getByRole('button', { name: 'Ver resultado' })).toBeTruthy()
    const sudoku = screen.getByRole('article', { name: 'Sudoku' })
    expect(within(sudoku).getByText('Ainda não jogou hoje')).toBeTruthy()
    expect(within(sudoku).getByRole('button', { name: 'Jogar Sudoku' })).toBeTruthy()
    expect(screen.getByRole('article', { name: 'Caça-palavras' })).toBeTruthy()
  })

  it('opens from Home\'s sidebar, under Amigos', async () => {
    const { Sidebar } = await import('../Sidebar')
    useNav.setState({ place: 'home', homePage: 'hub' })
    render(<Sidebar server={null} me={ME} />)
    fireEvent.click(screen.getByRole('button', { name: 'Jogos do dia' }))
    expect(useNav.getState().homePage).toBe('games')
  })
})

describe('the result shows the solved board', () => {
  const PUZZLE = { size: 3, numbers: [1, 0, 0, 0, 0, 0, 0, 0, 2], walls: [] }
  const PATH = [0, 1, 2, 5, 4, 3, 6, 7, 8]
  const onPath = (): number[] =>
    [...document.querySelectorAll('[aria-selected="true"]')].map((el) => Number((el as Element).getAttribute('data-cell'))).sort((a, b) => a - b)

  it('as I solved it, right away and read-only', async () => {
    vi.spyOn(api, 'api').mockResolvedValue({
      game: 'trilha',
      day: DAY,
      puzzle: PUZZLE,
      result: { game: 'trilha', day: DAY, time_ms: 95_000, attempts: 1, completed: true, answer: PATH },
      ranking: [],
      solution: PATH
    })
    render(<DailyGameModal game="trilha" onClose={() => {}} />)
    expect(await screen.findByRole('region', { name: 'Como ficou resolvido' })).toBeTruthy()
    expect(onPath()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(screen.queryByRole('button', { name: 'Recomeçar' })).toBeNull()
  })

  it('from the answer key when my solution was not kept', async () => {
    vi.spyOn(api, 'api').mockResolvedValue({
      game: 'trilha',
      day: DAY,
      puzzle: PUZZLE,
      result: { game: 'trilha', day: DAY, time_ms: 95_000, attempts: 1, completed: true },
      ranking: [],
      solution: PATH
    })
    render(<DailyGameModal game="trilha" onClose={() => {}} />)
    expect(await screen.findByRole('region', { name: 'Como ficou resolvido' })).toBeTruthy()
    expect(onPath()).toHaveLength(9)
  })
})

describe('streak badges (block 4.2.13)', () => {
  it('each game card shows its streak and freezes', async () => {
    vi.spyOn(api, 'api').mockImplementation(async (path) =>
      path === '/daily' ? { ...SUMMARY, streaks: { sudoku: { days: 9, freezes: 1 }, trilha: { days: 0, freezes: 0 }, cacapalavras: { days: 0, freezes: 0 } } } : []
    )
    render(<DailyGamesPage />)
    const sudoku = await screen.findByRole('article', { name: 'Sudoku' })
    expect(within(sudoku).getByText('9 dias seguidos')).toBeTruthy()
    expect(within(sudoku).getByText('1 congelamento')).toBeTruthy()
    expect(within(screen.getByRole('article', { name: 'Trilha' })).queryByText(/congelamento/)).toBeNull()
  })

  it('the inventory offers only the next level of each game', async () => {
    const { nextLevelsOnly } = await import('../BadgeInventory')
    const badge = (key: string) => ({ key }) as never
    const all = ['daily_sudoku_3', 'daily_sudoku_7', 'daily_sudoku_30', 'daily_trilha_3', 'daily_trilha_7', 'bug_hunter'].map(badge)
    const shown = (held: string[]) =>
      nextLevelsOnly(all.filter((b: { key: string }) => !held.includes(b.key)), new Set(held)).map((b: { key: string }) => b.key)
    expect(shown([])).toEqual(['daily_sudoku_3', 'daily_trilha_3', 'bug_hunter'])
    expect(shown(['daily_sudoku_7'])).toEqual(['daily_sudoku_30', 'daily_trilha_3', 'bug_hunter'])
  })
})
