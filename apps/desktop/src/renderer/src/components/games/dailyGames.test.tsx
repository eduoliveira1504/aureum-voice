/** Block 4.2.10: the daily Sudoku and Home's "Jogos do dia" card. */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../../lib/api'
import type { Friend, Me, User } from '../../lib/api'
import { formatDuration, sudokuConflicts, type DailySummary } from '../../lib/daily'
import { useDaily } from '../../store/daily'
import { useSocial } from '../../store/social'
import { DailyGameModal } from './DailyGameModal'
import { SudokuBoard } from './SudokuBoard'

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))
const ME = { id: 'me', username: 'me', display_name: 'Eu', avatar_url: null, badges: [], email: 'me@example.com' } as unknown as Me

// A solved grid; the puzzle hides its first two cells.
const SOLUTION = [
  5, 3, 4, 6, 7, 8, 9, 1, 2, 6, 7, 2, 1, 9, 5, 3, 4, 8, 1, 9, 8, 3, 4, 2, 5, 6, 7, 8, 5, 9, 7, 6, 1, 4, 2, 3, 4, 2, 6, 8, 5, 3, 7, 9, 1, 7, 1, 3, 9, 2, 4, 8, 5,
  6, 9, 6, 1, 5, 3, 7, 2, 8, 4, 2, 8, 7, 4, 1, 9, 6, 3, 5, 3, 4, 5, 2, 8, 6, 1, 7, 9
]
const GIVENS = [0, 0, ...SOLUTION.slice(2)]
const DAY = '2026-11-22'
const result = { game: 'sudoku', day: DAY, time_ms: 187_000, attempts: 2, completed: true }

describe('sudoku helpers', () => {
  it('finds repeated numbers in a row, a column or a box', () => {
    expect(sudokuConflicts(SOLUTION).size).toBe(0)
    const repeated = [...SOLUTION]
    repeated[1] = 5 // the first cell's 5 (same row and box) and the 5 further down its column
    expect([...sudokuConflicts(repeated)].sort((a, b) => a - b)).toEqual([0, 1, 28])
  })

  it('writes durations as minutes and seconds', () => {
    expect(formatDuration(187_000)).toBe('3:07')
    expect(formatDuration(3_735_000)).toBe('1:02:15')
    expect(formatDuration(-5)).toBe('0:00')
  })
})

describe('the board', () => {
  it('fills with the keyboard, keeps the given numbers, and hands over the full grid', () => {
    const onFilled = vi.fn()
    render(<SudokuBoard puzzle={{ size: 9, givens: GIVENS }} disabled={false} onFilled={onFilled} />)
    const grid = screen.getByRole('grid')
    // It starts on the first empty cell.
    fireEvent.keyDown(grid, { key: '5' })
    expect(screen.getByRole('gridcell', { name: 'Linha 1, coluna 1: 5' })).toBeTruthy()
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    fireEvent.keyDown(grid, { key: '5' })
    // A repeat is shown, and not sent.
    expect(screen.getByRole('gridcell', { name: 'Linha 1, coluna 2: 5' }).className).toContain('text-danger')
    expect(onFilled).not.toHaveBeenCalled()
    fireEvent.keyDown(grid, { key: 'Backspace' })
    fireEvent.click(screen.getByRole('button', { name: 'Número 3' }))
    expect(onFilled).toHaveBeenCalledWith(SOLUTION)
    // A given number can't be changed.
    fireEvent.click(screen.getByRole('gridcell', { name: 'Linha 1, coluna 3: 4' }))
    fireEvent.keyDown(grid, { key: '9' })
    expect(screen.getByRole('gridcell', { name: 'Linha 1, coluna 3: 4' })).toBeTruthy()
  })
})

describe('playing', () => {
  let answers: unknown[] = []
  beforeEach(() => {
    answers = []
    useDaily.setState({ summary: null, failed: false })
  })

  function mockApi(correctAfter: number): void {
    vi.spyOn(api, 'api').mockImplementation(async (path, options) => {
      if (path === '/daily/sudoku') return { game: 'sudoku', day: DAY, puzzle: { size: 9, givens: GIVENS }, result: null }
      if (path === '/daily/sudoku/check') {
        answers.push(options?.body)
        return answers.length >= correctAfter ? { correct: true, result } : { correct: false, result: null }
      }
      return { day: DAY, games: ['sudoku'], results: [result], streak: 1, friends_today: [] }
    })
  }

  const solve = async (): Promise<void> => {
    const grid = await screen.findByRole('grid')
    for (const key of ['5', 'ArrowRight', '3']) await act(async () => void fireEvent.keyDown(grid, { key }))
  }

  it('sends the answer for the API to check and shows the result', async () => {
    mockApi(1)
    render(<DailyGameModal game="sudoku" onClose={() => {}} />)
    await solve()
    expect(answers[0]).toMatchObject({ day: DAY, answer: SOLUTION })
    expect(await screen.findByText('Resolvido!')).toBeTruthy()
    expect(screen.getByText('3:07')).toBeTruthy()
    expect(useDaily.getState().summary?.results).toEqual([result])
  })

  it('says when something is wrong, and lets the person keep going', async () => {
    mockApi(2)
    render(<DailyGameModal game="sudoku" onClose={() => {}} />)
    await solve()
    expect(await screen.findByText('Ainda tem algo errado. Confira e tente de novo.')).toBeTruthy()
    expect(screen.getByRole('grid')).toBeTruthy()
  })

  it('opens straight on the result when today is already done', async () => {
    vi.spyOn(api, 'api').mockResolvedValue({ game: 'sudoku', day: DAY, puzzle: { size: 9, givens: GIVENS }, result })
    render(<DailyGameModal game="sudoku" onClose={() => {}} />)
    expect(await screen.findByText('Resolvido!')).toBeTruthy()
    expect(screen.queryByRole('grid')).toBeNull()
  })
})

describe('Home card', () => {
  const friend = (id: string, name: string): Friend =>
    ({ user: { id, username: id, display_name: name, avatar_url: null, badges: [] } as unknown as User, kind: 'friend', since: '2026-01-01T00:00:00Z', status: 'online' }) as Friend

  it('shows the games, my result, the streak and friends who played', async () => {
    const summary: DailySummary = { day: DAY, games: ['sudoku'], results: [result as never], streak: 3, friends_today: [{ user_id: 'ana', games: ['sudoku'] }, { user_id: 'bia', games: ['sudoku'] }] }
    vi.spyOn(api, 'api').mockImplementation(async (path) => (path === '/daily' ? summary : []))
    useSocial.setState({ friends: { ana: friend('ana', 'Ana'), bia: friend('bia', 'Bia') } })
    const { HomeHub } = await import('../HomeHub')
    render(<HomeHub me={ME} />)
    const card = await screen.findByRole('region', { name: 'Jogos do dia' })
    expect(within(card).getByText('3 dias seguidos')).toBeTruthy()
    expect(within(card).getByText(/Feito em 3:07/)).toBeTruthy()
    expect(within(card).getByText('Ana e mais 1 já jogaram hoje')).toBeTruthy()
  })
})
