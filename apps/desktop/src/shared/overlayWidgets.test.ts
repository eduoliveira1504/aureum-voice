import { describe, expect, it } from 'vitest'

import {
  anyWidgetOn,
  cleanWidgets,
  DEFAULT_WIDGETS,
  defaultBounds,
  legacyWidgets,
  rotateBox,
  splitPeople,
  widgetShows,
  type OverlayScene
} from './overlayWidgets'
import type { OverlayWidgets } from './types'

const AREA = { x: 1920, y: 0, width: 1920, height: 1040 }
const BOX = { x: 10, y: 20, width: 300, height: 200 }
const OVER_GAME: OverlayScene = { editing: false, active: true, clear: true, gameInFront: true, notifying: false, notice: false, asking: false }

const withOff = (...off: (keyof OverlayWidgets)[]): OverlayWidgets => {
  const widgets = structuredClone(DEFAULT_WIDGETS)
  for (const w of off) widgets[w].enabled = false
  return widgets
}

describe('cleanWidgets', () => {
  it('changes only what was given, per widget', () => {
    const next = cleanWidgets({ cameras: { layout: 'horizontal' }, voice: { opacity: 50 } }, DEFAULT_WIDGETS)
    expect(next.cameras).toEqual({ ...DEFAULT_WIDGETS.cameras, layout: 'horizontal' })
    expect(next.voice).toEqual({ ...DEFAULT_WIDGETS.voice, opacity: 50 })
    expect(next.notifications).toEqual(DEFAULT_WIDGETS.notifications)
  })

  it('keeps the base for invalid values and limits the rest', () => {
    const next = cleanWidgets({ voice: { size: 'huge', opacity: 5, enabled: 'yes' }, cameras: { layout: 'diagonal' } }, DEFAULT_WIDGETS)
    expect(next.voice).toMatchObject({ size: 'medium', opacity: 30, enabled: true })
    expect(next.cameras.layout).toBe('vertical')
  })

  it('drops broken positions, limits the box and remembers a few monitors only', () => {
    const positions = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`d${i}`, BOX]))
    const next = cleanWidgets(
      { voice: { positions: { ...positions, bad: { x: 'a' } } }, cameras: { positions: { d: { ...BOX, width: 5 } } } },
      DEFAULT_WIDGETS
    )
    expect(Object.keys(next.voice.positions)).toEqual(['d4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10', 'd11'])
    expect(next.cameras.positions.d.width).toBe(160)
  })
})

describe('legacyWidgets', () => {
  it('turns the single box into the voice widget, in the same place', () => {
    const widgets = legacyWidgets({ bounds: BOX, size: 'large', opacity: 70, showCameras: true, onlySpeaking: true }, () => 'd1')
    expect(widgets.voice).toEqual({ enabled: true, size: 'large', opacity: 70, onlySpeaking: true, positions: { d1: BOX } })
    expect(widgets.cameras).toMatchObject({ enabled: true, size: 'large', opacity: 70, positions: {} })
    expect(widgets.notifications).toEqual(DEFAULT_WIDGETS.notifications)
  })

  it('keeps the cameras off for who turned them off, and a box never placed stays unplaced', () => {
    const widgets = legacyWidgets({ bounds: null, showCameras: false }, () => 'd1')
    expect(widgets.cameras.enabled).toBe(false)
    expect(widgets.voice.positions).toEqual({})
  })
})

describe('defaultBounds', () => {
  it('starts on the monitor asked for, with notifications on the far side', () => {
    expect(defaultBounds('voice', AREA, 'vertical')).toMatchObject({ x: 1936, y: 16 })
    expect(defaultBounds('notifications', AREA, 'vertical')).toMatchObject({ x: 1920 + 1920 - 320 - 16, y: 16 })
  })

  it('puts the cameras under the voice list, on its side when horizontal', () => {
    const voice = defaultBounds('voice', AREA, 'vertical')
    const vertical = defaultBounds('cameras', AREA, 'vertical')
    const horizontal = defaultBounds('cameras', AREA, 'horizontal')
    expect(vertical.y).toBeGreaterThan(voice.y + voice.height)
    expect([horizontal.width, horizontal.height]).toEqual([vertical.height, vertical.width])
  })
})

it('rotateBox swaps the box of every monitor', () => {
  const rotated = rotateBox({ ...DEFAULT_WIDGETS.cameras, positions: { d1: BOX } })
  expect(rotated.positions.d1).toEqual({ ...BOX, width: 200, height: 300 })
})

describe('widgetShows', () => {
  const widgets = withOff()

  it('shows voice and cameras over a game in a call, never over anything else', () => {
    expect(widgetShows('voice', widgets, OVER_GAME)).toBe(true)
    expect(widgetShows('cameras', widgets, OVER_GAME)).toBe(true)
    for (const scene of [{ gameInFront: false }, { clear: false }, { active: false }]) {
      expect(widgetShows('voice', widgets, { ...OVER_GAME, ...scene })).toBe(false)
      expect(widgetShows('cameras', widgets, { ...OVER_GAME, ...scene })).toBe(false)
    }
  })

  it('never shows a widget that is off, even while editing', () => {
    const off = withOff('voice', 'cameras', 'notifications')
    for (const scene of [OVER_GAME, { ...OVER_GAME, editing: true }, { ...OVER_GAME, notifying: true }]) {
      expect(widgetShows('voice', off, scene)).toBe(false)
      expect(widgetShows('cameras', off, scene)).toBe(false)
      expect(widgetShows('notifications', off, scene)).toBe(false)
    }
  })

  it('shows notifications only while one is up, over a game, in a call or not', () => {
    expect(widgetShows('notifications', widgets, OVER_GAME)).toBe(false)
    expect(widgetShows('notifications', widgets, { ...OVER_GAME, notifying: true })).toBe(true)
    expect(widgetShows('notifications', widgets, { ...OVER_GAME, notifying: true, active: false })).toBe(true)
    expect(widgetShows('notifications', widgets, { ...OVER_GAME, notifying: true, gameInFront: false })).toBe(false)
  })

  it('keeps the messages and the question in the voice window with the widget off', () => {
    const off = withOff('voice')
    expect(widgetShows('voice', off, { ...OVER_GAME, notice: true })).toBe(true)
    expect(widgetShows('voice', off, { ...OVER_GAME, asking: true, gameInFront: false })).toBe(true)
  })

  it('shows every widget that is on while editing, outside a game or a call', () => {
    const scene = { ...OVER_GAME, editing: true, active: false, clear: false, gameInFront: false }
    expect(widgetShows('voice', widgets, scene)).toBe(true)
    expect(widgetShows('cameras', widgets, scene)).toBe(true)
    expect(widgetShows('notifications', widgets, scene)).toBe(true)
  })
})

describe('splitPeople', () => {
  const people = [{ id: 'a', camera: 'track' }, { id: 'b' }]

  it('moves who has a camera to the cameras widget', () => {
    expect(splitPeople(people, true)).toEqual({ voice: [people[1]], cameras: [people[0]] })
  })

  it('keeps everyone in the list with the cameras widget off', () => {
    expect(splitPeople(people, false)).toEqual({ voice: people, cameras: [] })
  })
})

it('anyWidgetOn tells whether something can show at all', () => {
  expect(anyWidgetOn(withOff('voice', 'cameras'))).toBe(true)
  expect(anyWidgetOn(withOff('voice', 'cameras', 'notifications'))).toBe(false)
})
