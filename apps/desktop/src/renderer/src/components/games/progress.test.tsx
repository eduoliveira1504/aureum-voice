/** Closing a daily game keeps the board and the time played: it picks up from there (Eduardo, 22/11). */

import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../../lib/api'
import type { Me } from '../../lib/api'
import type { TrilhaPuzzle, WordSearchPuzzle } from '../../lib/daily'
import { useChat } from '../../store/chat'
import { useDaily } from '../../store/daily'
import { DailyGameModal } from './DailyGameModal'

const ME = { id: 'me', username: 'me', display_name: 'Eu', avatar_url: null, badges: [], email: 'me@example.com' } as unknown as Me
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))
const DAY = '2026-11-22'
const TRILHA: TrilhaPuzzle = { size: 3, numbers: [1, 0, 0, 0, 0, 0, 0, 0, 2], walls: [] }

let saved: unknown[] = []
function mockApi(game: string, puzzle: unknown, progress: unknown): void {
  saved = []
  vi.spyOn(api, 'api').mockImplementation(async (path, options) => {
    if (path === `/daily/${game}`) return { game, day: DAY, puzzle, result: null, ranking: [], progress }
    if (path === `/daily/${game}/progress`) {
      saved.push(options?.body)
      return undefined
    }
    return []
  })
}

beforeEach(() => {
  useChat.setState({ meId: 'me' })
  useDaily.setState({ summary: null, failed: false })
})

describe('a game in progress', () => {
  it('opens where it was left, the clock picking up from the time played', async () => {
    mockApi('trilha', TRILHA, { state: { path: [0, 1, 2] }, elapsed_ms: 8_000 })
    render(<DailyGameModal game="trilha" onClose={() => {}} />)
    expect(await screen.findByLabelText('Tempo')).toBeTruthy()
    expect(screen.getByLabelText('Tempo').textContent).toBe('0:08')
    const drawn = [...document.querySelectorAll('[aria-selected="true"]')].map((el) => el.getAttribute('data-cell'))
    expect(drawn).toEqual(['0', '1', '2'])
  })

  it('keeps the board and the time when the game is closed', async () => {
    mockApi('cacapalavras', { size: 4, theme: 'Teste', rows: ['GATO', 'EXYZ', 'MQWK', 'ACAM'], words: ['gato', 'gema'] } as WordSearchPuzzle, {
      state: { found: [[0, 3], null], order: [0] },
      elapsed_ms: 30_000
    })
    const { unmount } = render(<DailyGameModal game="cacapalavras" onClose={() => {}} />)
    expect(await screen.findByLabelText('gato (achada)')).toBeTruthy()
    await act(async () => unmount())
    const last = saved.at(-1) as { day: string; state: unknown; elapsed_ms: number }
    expect(last.day).toBe(DAY)
    expect(last.state).toEqual({ found: [[0, 3], null], order: [0] })
    expect(last.elapsed_ms).toBeGreaterThanOrEqual(30_000)
  })

  it('a solved game keeps nothing', async () => {
    saved = []
    vi.spyOn(api, 'api').mockImplementation(async (path, options) => {
      if (path === '/daily/trilha') return { game: 'trilha', day: DAY, puzzle: TRILHA, result: { game: 'trilha', day: DAY, time_ms: 1000, attempts: 1, completed: true }, ranking: [] }
      if (path === '/daily/trilha/progress') saved.push(options?.body)
      return []
    })
    const { unmount } = render(<DailyGameModal game="trilha" onClose={() => {}} />)
    expect(await screen.findByText('Resolvido!')).toBeTruthy()
    await act(async () => unmount())
    expect(saved).toEqual([])
  })
})
