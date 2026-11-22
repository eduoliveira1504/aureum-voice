/** Block 4.2.10 follow-up: hints every 30 s, the drawn difficulty, word colors, my picture in the ranking. */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../../lib/api'
import type { Me } from '../../lib/api'
import type { SudokuPuzzle, TrilhaPuzzle, WordSearchPuzzle } from '../../lib/daily'
import { useChat } from '../../store/chat'
import { useDaily } from '../../store/daily'
import { useSocial } from '../../store/social'
import { DailyGameModal, Ranking } from './DailyGameModal'
import { SudokuBoard } from './SudokuBoard'
import { TrilhaBoard } from './TrilhaBoard'
import { WORD_COLORS, WordSearchBoard } from './WordSearchBoard'

const ME = { id: 'me', username: 'me', display_name: 'Eu', avatar_url: '/media/me.png', badges: [], email: 'me@example.com' } as unknown as Me
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))
const DAY = '2026-11-22'
const SOLUTION = [
  5, 3, 4, 6, 7, 8, 9, 1, 2, 6, 7, 2, 1, 9, 5, 3, 4, 8, 1, 9, 8, 3, 4, 2, 5, 6, 7, 8, 5, 9, 7, 6, 1, 4, 2, 3, 4, 2, 6, 8, 5, 3, 7, 9, 1, 7, 1, 3, 9, 2, 4, 8, 5,
  6, 9, 6, 1, 5, 3, 7, 2, 8, 4, 2, 8, 7, 4, 1, 9, 6, 3, 5, 3, 4, 5, 2, 8, 6, 1, 7, 9
]
const SUDOKU: SudokuPuzzle = { size: 9, difficulty: 'dificil', givens: [0, 0, ...SOLUTION.slice(2)] }

beforeEach(() => {
  useChat.setState({ meId: 'me' })
  useSocial.setState({ friends: {} })
  useDaily.setState({ summary: null, failed: false })
})

describe('hints', () => {
  it('the button asks the API with where the board is, then waits 30 s', async () => {
    const asked: unknown[] = []
    vi.spyOn(api, 'api').mockImplementation(async (path, options) => {
      if (path === '/daily/sudoku') return { game: 'sudoku', day: DAY, puzzle: SUDOKU, result: null, ranking: [] }
      if (path === '/daily/sudoku/hint') {
        asked.push(options?.body)
        return { hint: { cell: 0, value: 5 }, used: 1 }
      }
      return []
    })
    render(<DailyGameModal game="sudoku" onClose={() => {}} />)
    expect(await screen.findByText('Difícil')).toBeTruthy()
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Dica' })))
    expect(asked[0]).toEqual({ day: DAY, state: SUDOKU.givens })
    // The number goes in place, and the next hint has to wait.
    expect(screen.getByRole('gridcell', { name: 'Linha 1, coluna 1: 5' }).className).toContain('text-success')
    expect((screen.getByRole('button', { name: /Dica em \d+s/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('1 dica usada')).toBeTruthy()
  })

  it('Sudoku: a hint locks its number, and the last one solves it', () => {
    const onFilled = vi.fn()
    const { rerender } = render(<SudokuBoard puzzle={SUDOKU} disabled={false} onFilled={onFilled} hint={null} />)
    rerender(<SudokuBoard puzzle={SUDOKU} disabled={false} onFilled={onFilled} hint={{ n: 1, cell: 0, value: 5 }} />)
    fireEvent.keyDown(screen.getByRole('grid'), { key: '9' }) // locked: typing leaves it alone
    expect(screen.getByRole('gridcell', { name: 'Linha 1, coluna 1: 5' })).toBeTruthy()
    rerender(<SudokuBoard puzzle={SUDOKU} disabled={false} onFilled={onFilled} hint={{ n: 2, cell: 1, value: 3 }} />)
    expect(onFilled).toHaveBeenCalledWith(SOLUTION)
  })

  it('Trilha: cuts back to what was right and marks the next cell', () => {
    const puzzle: TrilhaPuzzle = { size: 3, numbers: [1, 0, 0, 0, 0, 0, 0, 0, 2], walls: [] }
    const { rerender } = render(<TrilhaBoard puzzle={puzzle} disabled={false} onFilled={() => {}} hint={null} />)
    fireEvent.pointerDown(document.querySelector('[data-cell="0"]') as Element)
    for (const i of [3, 4]) fireEvent.pointerEnter(document.querySelector(`[data-cell="${i}"]`) as Element)
    fireEvent.pointerUp(window)
    rerender(<TrilhaBoard puzzle={puzzle} disabled={false} onFilled={() => {}} hint={{ n: 1, keep: 1, cell: 1 }} />)
    expect([...document.querySelectorAll('[aria-selected="true"]')].map((el) => el.getAttribute('data-cell'))).toEqual(['0'])
    expect(document.querySelector('[data-hint-cell="1"]')).toBeTruthy()
  })
})

describe('Caça-palavras colors', () => {
  // G A T O
  // E X Y Z
  // M Q W K
  // A C A M
  const PUZZLE: WordSearchPuzzle = { size: 4, theme: 'Teste', rows: ['GATO', 'EXYZ', 'MQWK', 'ACAM'], words: ['gato', 'gema', 'maçã'] }
  const cell = (i: number): HTMLElement => document.querySelector(`[data-cell="${i}"]`) as HTMLElement
  const drag = (...cells: number[]): void => {
    fireEvent.pointerDown(cell(cells[0]))
    for (const i of cells.slice(1)) fireEvent.pointerEnter(cell(i))
    fireEvent.pointerUp(window)
  }

  it('each found word gets its own color, and a shared letter keeps the last one', () => {
    render(<WordSearchBoard puzzle={PUZZLE} disabled={false} onFilled={() => {}} />)
    drag(0, 1, 2, 3) // GATO
    expect(cell(1).className).toContain(WORD_COLORS[0])
    drag(0, 4, 8, 12) // GEMA, sharing the G
    expect(cell(4).className).toContain(WORD_COLORS[1])
    expect(cell(0).className).toContain(WORD_COLORS[1])
    expect(cell(0).className).not.toContain(WORD_COLORS[0])
  })

  it('a hint marks where a missing word begins', () => {
    const { rerender } = render(<WordSearchBoard puzzle={PUZZLE} disabled={false} onFilled={() => {}} hint={null} />)
    rerender(<WordSearchBoard puzzle={PUZZLE} disabled={false} onFilled={() => {}} hint={{ n: 1, word: 2, cell: 15 }} />)
    expect(cell(15).className).toContain('ring-success')
  })
})

describe('ranking', () => {
  it('my row has my picture, not an initial, and the hints I used', () => {
    useSocial.setState({ friends: { ana: { user: { id: 'ana', username: 'ana', display_name: 'Ana', avatar_url: null, badges: [] }, kind: 'friend' } } as never })
    render(
      <Ranking
        entries={[
          { user_id: 'me', time_ms: 24_000, attempts: 1, hints: 2 },
          { user_id: 'ana', time_ms: 30_000, attempts: 1 }
        ]}
      />
    )
    const [mine] = within(screen.getByRole('region', { name: 'Ranking dos amigos' })).getAllByRole('listitem')
    expect(mine.querySelector('img')?.getAttribute('src')).toContain('me.png')
    expect(within(mine).getByTitle('2 dicas usadas')).toBeTruthy()
  })
})
