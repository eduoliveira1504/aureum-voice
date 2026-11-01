import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_WIDGETS } from '../../../shared/overlayWidgets'
import type { OverlayState } from '../../../shared/types'
import { notificationText } from '../components/OverlayWidgets'
import { useAppearance } from './appearance'
import { callChanges, NOTIFICATION_MS, notifyOverlay, useOverlay } from './overlay'

const state = (enabled: boolean, widgetOn: boolean): OverlayState => ({
  prefs: {
    enabled,
    toggleShortcut: 'Control+Shift+F9',
    editShortcut: 'Control+Shift+F10',
    widgets: { ...DEFAULT_WIDGETS, notifications: { ...DEFAULT_WIDGETS.notifications, enabled: widgetOn } },
    hiddenApps: [],
    games: [],
    notGames: []
  },
  editing: false,
  failedShortcuts: [],
  notice: null,
  ask: null
})

const DM = { kind: 'dm', name: 'Ana', username: 'ana', text: 'oi' } as const
const setStatus = (status: 'online' | 'dnd'): void =>
  useAppearance.setState((s) => ({ settings: { ...s.settings, status } }))

describe('notifyOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    useOverlay.setState({ state: state(true, true), notifications: [] })
    setStatus('online')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('goes away by itself after about five seconds', () => {
    notifyOverlay(DM)
    expect(useOverlay.getState().notifications).toHaveLength(1)
    vi.advanceTimersByTime(NOTIFICATION_MS - 1)
    expect(useOverlay.getState().notifications).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useOverlay.getState().notifications).toHaveLength(0)
  })

  it('keeps only the newest few', () => {
    for (let i = 0; i < 6; i++) notifyOverlay({ ...DM, text: String(i) })
    expect(useOverlay.getState().notifications.map((n) => n.text)).toEqual(['2', '3', '4', '5'])
  })

  it.each([
    ['the widget is off', () => useOverlay.setState({ state: state(true, false) })],
    ['the overlay is off', () => useOverlay.setState({ state: state(false, true) })],
    ['the app is in front', () => vi.spyOn(document, 'hasFocus').mockReturnValue(true)],
    ['do not disturb is on', () => setStatus('dnd')]
  ])('shows nothing while %s', (_, arrange) => {
    arrange()
    notifyOverlay(DM)
    expect(useOverlay.getState().notifications).toEqual([])
  })
})

describe('notificationText', () => {
  it('shows the message, or only who sent it when the content is hidden', () => {
    expect(notificationText(DM, false)).toEqual({ title: 'Ana', body: 'oi' })
    expect(notificationText(DM, true)).toEqual({ title: '@ana te mandou mensagem' })
    expect(notificationText({ ...DM, kind: 'mention' }, true)).toEqual({ title: '@ana te mencionou' })
  })

  it('has no message to hide in calls', () => {
    expect(notificationText({ kind: 'call', name: 'Ana' }, true)).toEqual({ title: 'Ana', body: 'está te ligando' })
    expect(notificationText({ kind: 'joined', name: 'Ana' }, false)).toEqual({ title: 'Ana entrou na call' })
    expect(notificationText({ kind: 'left', name: 'Ana' }, false)).toEqual({ title: 'Ana saiu da call' })
  })
})

it('callChanges tells who joined and left, never me', () => {
  expect(callChanges(new Set(['me', 'a', 'b']), new Set(['a', 'c']), 'me')).toEqual({ joined: ['c'], left: ['b'] })
})
