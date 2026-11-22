/**
 * Daily games on Home (block 4.2.10). The API makes each day's puzzle and checks the answers
 * (apps/api/app/daily); the app only gets the puzzle and sends what the person filled in.
 */

import { api } from './api'

export type DailyGameKey = 'sudoku'

export interface DailyResult {
  game: DailyGameKey
  /** yyyy-mm-dd, the Brasília day. */
  day: string
  time_ms: number
  attempts: number
  completed: boolean
}

export interface DailySummary {
  day: string
  games: DailyGameKey[]
  results: DailyResult[]
  streak: number
  friends_today: { user_id: string; games: DailyGameKey[] }[]
}

export interface SudokuPuzzle {
  size: 9
  /** 81 cells, row by row: 1–9 given, 0 to fill in. */
  givens: number[]
}

export interface DailyPuzzle<P = unknown> {
  game: DailyGameKey
  day: string
  puzzle: P
  result: DailyResult | null
}

export interface CheckResult {
  correct: boolean
  result: DailyResult | null
}

export const loadSummary = (): Promise<DailySummary> => api<DailySummary>('/daily')
export const loadPuzzle = <P>(game: DailyGameKey): Promise<DailyPuzzle<P>> => api<DailyPuzzle<P>>(`/daily/${game}`)
export const checkAnswer = (game: DailyGameKey, day: string, answer: unknown, timeMs: number): Promise<CheckResult> =>
  api<CheckResult>(`/daily/${game}/check`, { method: 'POST', body: { day, answer, time_ms: Math.round(timeMs) } })

/** "3:07", "1:02:15". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** Sudoku cells that repeat a number in their row, column or 3×3 box. */
export function sudokuConflicts(cells: number[]): Set<number> {
  const out = new Set<number>()
  const groups: number[][] = []
  for (let i = 0; i < 9; i++) {
    groups.push(Array.from({ length: 9 }, (_, j) => i * 9 + j))
    groups.push(Array.from({ length: 9 }, (_, j) => j * 9 + i))
    const r = Math.floor(i / 3) * 3
    const c = (i % 3) * 3
    groups.push(Array.from({ length: 9 }, (_, j) => (r + Math.floor(j / 3)) * 9 + c + (j % 3)))
  }
  for (const group of groups) {
    const seen = new Map<number, number[]>()
    for (const i of group) if (cells[i]) seen.set(cells[i], [...(seen.get(cells[i]) ?? []), i])
    for (const same of seen.values()) if (same.length > 1) same.forEach((i) => out.add(i))
  }
  return out
}
