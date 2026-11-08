import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHECK_LIMIT_MS, createStartup, DOWNLOAD_MAX_MS, MAX_MS, MIN_MS, STALL_MS, TEXT } from './startup'

function setup(checkUpdates: boolean) {
  const hooks = { status: vi.fn(), open: vi.fn(), install: vi.fn() }
  const startup = createStartup(hooks, { checkUpdates })
  startup.shown()
  const texts = (): string[] => hooks.status.mock.calls.map(([text]) => text)
  return { hooks, startup, texts }
}

describe('loading screen', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('opens by itself once the app is ready, never before the minimum time', () => {
    const { hooks, startup, texts } = setup(false)
    expect(texts()).toEqual([TEXT.connecting])
    vi.advanceTimersByTime(300)
    startup.appReady(true)
    expect(hooks.open).not.toHaveBeenCalled()
    vi.advanceTimersByTime(MIN_MS - 300 - 1)
    expect(hooks.open).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(hooks.open).toHaveBeenCalledOnce()
    expect(texts().at(-1)).toBe(TEXT.opening)
    expect(startup.done).toBe(true)
  })

  it('opens right away when the app takes longer than the minimum', () => {
    const { hooks, startup } = setup(false)
    vi.advanceTimersByTime(3000)
    startup.appReady(true)
    expect(hooks.open).toHaveBeenCalledOnce()
  })

  it('opens anyway at the maximum time when the app never reports', () => {
    const { hooks } = setup(false)
    vi.advanceTimersByTime(MAX_MS - 1)
    expect(hooks.open).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(hooks.open).toHaveBeenCalledOnce()
  })

  it('without a connection says so and still opens', () => {
    const { hooks, startup, texts } = setup(false)
    startup.appReady(false)
    vi.advanceTimersByTime(MIN_MS)
    expect(hooks.open).toHaveBeenCalledOnce()
    expect(texts()).toEqual([TEXT.connecting, TEXT.offline])
  })

  it('waits for the update check before opening', () => {
    const { hooks, startup, texts } = setup(true)
    expect(texts()).toEqual([TEXT.checking])
    startup.appReady(true)
    vi.advanceTimersByTime(2000)
    expect(hooks.open).not.toHaveBeenCalled()
    startup.update({ kind: 'none' })
    expect(hooks.open).toHaveBeenCalledOnce()
    expect(texts()).toEqual([TEXT.checking, TEXT.connecting, TEXT.opening])
  })

  it('a check past its limit lets the app open', () => {
    const { hooks, startup } = setup(true)
    startup.appReady(true)
    vi.advanceTimersByTime(CHECK_LIMIT_MS - 1)
    expect(hooks.open).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(hooks.open).toHaveBeenCalledOnce()
    // The check answering later changes nothing.
    startup.update({ kind: 'downloading', percent: 10 })
    startup.update({ kind: 'downloaded' })
    expect(hooks.install).not.toHaveBeenCalled()
  })

  it('a failed check opens normally; offline shows the offline line', () => {
    const { hooks, startup, texts } = setup(true)
    startup.update({ kind: 'failed', offline: true })
    startup.appReady(false)
    vi.advanceTimersByTime(MIN_MS)
    expect(hooks.open).toHaveBeenCalledOnce()
    expect(texts()).toEqual([TEXT.checking, TEXT.offline])
  })

  it('shows the download percentage and restarts into the new version', () => {
    const { hooks, startup, texts } = setup(true)
    startup.appReady(true)
    for (const percent of [5.4, 40, 99.9]) {
      vi.advanceTimersByTime(3000)
      startup.update({ kind: 'downloading', percent })
    }
    // Past the usual maximum, but the download keeps moving.
    vi.advanceTimersByTime(3000)
    expect(hooks.open).not.toHaveBeenCalled()
    startup.update({ kind: 'downloaded' })
    expect(hooks.install).toHaveBeenCalledOnce()
    expect(hooks.open).not.toHaveBeenCalled()
    expect(texts()).toEqual([TEXT.checking, TEXT.downloading(5), TEXT.downloading(40), TEXT.downloading(99)])
  })

  it('a stalled download lets the app open', () => {
    const { hooks, startup } = setup(true)
    startup.appReady(true)
    startup.update({ kind: 'downloading', percent: 1 })
    vi.advanceTimersByTime(STALL_MS - 1)
    expect(hooks.open).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(hooks.open).toHaveBeenCalledOnce()
  })

  it('a slow but moving download stops holding the screen at the download limit', () => {
    const { hooks, startup } = setup(true)
    startup.appReady(true)
    for (let t = 0; t < DOWNLOAD_MAX_MS; t += 5000) {
      startup.update({ kind: 'downloading', percent: t / 1000 })
      vi.advanceTimersByTime(5000)
    }
    expect(hooks.open).toHaveBeenCalledOnce()
    expect(hooks.install).not.toHaveBeenCalled()
  })

  it('a download finishing while the app still loads installs it', () => {
    const { hooks, startup } = setup(true)
    startup.update({ kind: 'downloading', percent: 50 })
    startup.update({ kind: 'downloaded' })
    expect(hooks.install).toHaveBeenCalledOnce()
    startup.appReady(true)
    vi.advanceTimersByTime(MAX_MS)
    expect(hooks.open).not.toHaveBeenCalled()
  })

  it('counts the minimum time from when the screen appears', () => {
    const hooks = { status: vi.fn(), open: vi.fn(), install: vi.fn() }
    const startup = createStartup(hooks, { checkUpdates: false })
    vi.advanceTimersByTime(900) // Electron still starting the screen
    startup.shown()
    startup.appReady(true)
    vi.advanceTimersByTime(MIN_MS - 1)
    expect(hooks.open).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(hooks.open).toHaveBeenCalledOnce()
  })

  it('an app ready before the screen appears still waits for it', () => {
    const hooks = { status: vi.fn(), open: vi.fn(), install: vi.fn() }
    const startup = createStartup(hooks, { checkUpdates: false })
    startup.appReady(true)
    vi.advanceTimersByTime(300)
    expect(hooks.open).not.toHaveBeenCalled()
    startup.shown()
    vi.advanceTimersByTime(MIN_MS)
    expect(hooks.open).toHaveBeenCalledOnce()
  })

  it('a screen that never appears still lets the app open at the maximum time', () => {
    const hooks = { status: vi.fn(), open: vi.fn(), install: vi.fn() }
    const startup = createStartup(hooks, { checkUpdates: false })
    startup.appReady(true)
    vi.advanceTimersByTime(MAX_MS)
    expect(hooks.open).toHaveBeenCalledOnce()
  })
})
