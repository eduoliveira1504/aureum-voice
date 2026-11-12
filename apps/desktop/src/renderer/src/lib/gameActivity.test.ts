/** Block 4.1.3: while playing, the app confirms the activity again before the API lets it go. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendRealtime = vi.fn((..._args: unknown[]) => true)
vi.mock('./realtime', () => ({ sendRealtime: (...args: unknown[]) => sendRealtime(...args) }))

import { RECONFIRM_MS, startActivityReporting } from './gameActivity'

let changeGame: (game: string | null) => void = () => {}

beforeEach(() => {
  vi.useFakeTimers()
  sendRealtime.mockClear()
  window.aureum.games.current = async () => 'VALORANT'
  window.aureum.games.onChange = (cb: (game: string | null) => void) => {
    changeGame = cb
    return () => {}
  }
})
afterEach(() => vi.useRealTimers())

describe('game activity', () => {
  it('is confirmed again every couple of minutes while playing', async () => {
    const stop = startActivityReporting()
    await vi.advanceTimersByTimeAsync(0)
    expect(sendRealtime).toHaveBeenLastCalledWith('activity.set', { name: 'VALORANT' })
    sendRealtime.mockClear()

    await vi.advanceTimersByTimeAsync(RECONFIRM_MS)
    expect(sendRealtime).toHaveBeenCalledWith('activity.set', { name: 'VALORANT' })
    // Well inside the API's 5 minutes.
    expect(RECONFIRM_MS).toBeLessThan(300_000 / 2)
    stop()
  })

  it('sends nothing more once the game is closed', async () => {
    const stop = startActivityReporting()
    await vi.advanceTimersByTimeAsync(0)
    changeGame(null)
    expect(sendRealtime).toHaveBeenLastCalledWith('activity.set', null)
    sendRealtime.mockClear()
    await vi.advanceTimersByTimeAsync(RECONFIRM_MS * 3)
    expect(sendRealtime).not.toHaveBeenCalled()
    stop()
  })

  it('stops confirming when the app stops reporting (signed out)', async () => {
    const stop = startActivityReporting()
    await vi.advanceTimersByTimeAsync(0)
    stop()
    sendRealtime.mockClear()
    await vi.advanceTimersByTimeAsync(RECONFIRM_MS * 3)
    expect(sendRealtime).not.toHaveBeenCalled()
  })
})
