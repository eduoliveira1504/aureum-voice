import { describe, expect, it } from 'vitest'

import {
  anchoredBox,
  anyWidgetOn,
  CAMERA_SIZES,
  cameraLayout,
  cleanWidgets,
  DEFAULT_WIDGETS,
  defaultBounds,
  legacyWidgets,
  rotateBox,
  splitPeople,
  visibleCameras,
  widgetShows,
  type OverlayScene
} from './overlayWidgets'
import type { OverlayCameraPrefs, OverlayWidgets } from './types'

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

describe('camera preferences', () => {
  it('keeps what a file from before block 3.22 had: the layout, the size as a width and the place', () => {
    const old = { enabled: true, size: 'large', opacity: 70, layout: 'horizontal', positions: { d1: BOX } }
    const cameras = cleanWidgets({ cameras: old }, DEFAULT_WIDGETS).cameras
    expect(cameras).toMatchObject({ enabled: true, size: 'large', opacity: 70, layout: 'horizontal', positions: { d1: BOX } })
    expect(cameras.tileWidth).toBe(CAMERA_SIZES.large)
    expect(cameras).toMatchObject({ maxVisible: 4, perRow: 2, gap: 6, rounded: true })
  })

  it('takes a size shortcut as its width, and a width brings the nearest size along', () => {
    const base = DEFAULT_WIDGETS
    expect(cleanWidgets({ cameras: { size: 'small' } }, base).cameras).toMatchObject({ size: 'small', tileWidth: CAMERA_SIZES.small })
    expect(cleanWidgets({ cameras: { tileWidth: 300 } }, base).cameras).toMatchObject({ size: 'large', tileWidth: 300 })
    expect(cleanWidgets({ cameras: { tileWidth: 100 } }, base).cameras).toMatchObject({ size: 'small', tileWidth: 100 })
    // Changing something else keeps a width that isn't one of the shortcuts.
    const custom = cleanWidgets({ cameras: { tileWidth: 300 } }, base)
    expect(cleanWidgets({ cameras: { layout: 'grid' } }, custom).cameras.tileWidth).toBe(300)
  })

  it('limits every number and accepts the grid', () => {
    const raw = { layout: 'grid', tileWidth: 5000, maxVisible: 0, perRow: 20, gap: -3, rounded: 'no' }
    const cameras = cleanWidgets({ cameras: raw }, DEFAULT_WIDGETS).cameras
    expect(cameras).toMatchObject({ layout: 'grid', tileWidth: 360, maxVisible: 1, perRow: 8, gap: 0, rounded: true })
    expect(cleanWidgets({ cameras: { tileWidth: 10 } }, DEFAULT_WIDGETS).cameras.tileWidth).toBe(96)
  })
})

describe('cameraLayout', () => {
  const prefs = (patch: Partial<OverlayCameraPrefs>): OverlayCameraPrefs => ({ ...DEFAULT_WIDGETS.cameras, gap: 6, tileWidth: 160, ...patch })
  // 160 px wide -> 90 px tall; 8 px of padding on each side.
  const shape = (p: Partial<OverlayCameraPrefs>, n: number): number[] => {
    const l = cameraLayout(prefs(p), n, false)
    return [l.columns, l.rows, l.width, l.height]
  }

  it('vertical: one column, the box as tall as the cameras', () => {
    expect(shape({ layout: 'vertical' }, 1)).toEqual([1, 1, 176, 106])
    expect(shape({ layout: 'vertical' }, 3)).toEqual([1, 3, 176, 3 * 90 + 2 * 6 + 16])
    expect(shape({ layout: 'vertical' }, 8)).toEqual([1, 8, 176, 8 * 90 + 7 * 6 + 16])
  })

  it('horizontal: one row, the box as wide as the cameras', () => {
    expect(shape({ layout: 'horizontal' }, 1)).toEqual([1, 1, 176, 106])
    expect(shape({ layout: 'horizontal' }, 3)).toEqual([3, 1, 3 * 160 + 2 * 6 + 16, 106])
    expect(shape({ layout: 'horizontal' }, 8)).toEqual([8, 1, 8 * 160 + 7 * 6 + 16, 106])
  })

  it('grid: up to perRow per line, fewer when there are fewer cameras', () => {
    expect(shape({ layout: 'grid', perRow: 3 }, 1)).toEqual([1, 1, 176, 106])
    expect(shape({ layout: 'grid', perRow: 3 }, 3)).toEqual([3, 1, 3 * 160 + 2 * 6 + 16, 106])
    expect(shape({ layout: 'grid', perRow: 3 }, 8)).toEqual([3, 3, 3 * 160 + 2 * 6 + 16, 3 * 90 + 2 * 6 + 16])
  })

  it('follows the width, from the smallest to the largest', () => {
    expect(cameraLayout(prefs({ tileWidth: 96 }), 1, false)).toMatchObject({ tileWidth: 96, tileHeight: 54, width: 112, height: 70 })
    expect(cameraLayout(prefs({ tileWidth: 360 }), 1, false)).toMatchObject({ tileWidth: 360, tileHeight: 203, width: 376, height: 219 })
  })

  it('follows the space between the cameras', () => {
    expect(cameraLayout(prefs({ layout: 'horizontal', gap: 0 }), 2, false).width).toBe(2 * 160 + 16)
    expect(cameraLayout(prefs({ layout: 'horizontal', gap: 16 }), 2, false).width).toBe(2 * 160 + 16 + 16)
  })

  it('shrinks the cameras to fit the monitor instead of cutting them off', () => {
    const area = { width: 1920, height: 1040 }
    const wide = cameraLayout(prefs({ layout: 'horizontal', tileWidth: 360 }), 8, false, area)
    expect(wide.width).toBeLessThanOrEqual(area.width)
    expect(wide.tileWidth).toBeLessThan(360)
    const tall = cameraLayout(prefs({ layout: 'vertical', tileWidth: 360 }), 8, false, area)
    expect(tall.height).toBeLessThanOrEqual(area.height)
    // What fits stays as chosen.
    expect(cameraLayout(prefs({ tileWidth: 200 }), 2, false, area).tileWidth).toBe(200)
  })

  it('leaves room for the edit bar', () => {
    const plain = cameraLayout(prefs({}), 1, false)
    const editing = cameraLayout(prefs({}), 1, true)
    expect(editing.height).toBe(plain.height + 40)
    expect(editing.width).toBeGreaterThanOrEqual(300)
  })
})

describe('visibleCameras', () => {
  const people = ['a', 'b', 'c', 'd', 'e']
  const none = (): boolean => false

  it('shows everyone up to the limit', () => {
    expect(visibleCameras(people.slice(0, 3), 4, none)).toEqual({ shown: ['a', 'b', 'c'], hidden: 0 })
    expect(visibleCameras(people.slice(0, 1), 1, none)).toEqual({ shown: ['a'], hidden: 0 })
  })

  it('past the limit, the first ones and how many are left out', () => {
    expect(visibleCameras(people, 3, none)).toEqual({ shown: ['a', 'b', 'c'], hidden: 2 })
  })

  it('whoever is speaking always shows, in the call order', () => {
    expect(visibleCameras(people, 3, (p) => p === 'e')).toEqual({ shown: ['a', 'b', 'e'], hidden: 2 })
    expect(visibleCameras(people, 1, (p) => p === 'd')).toEqual({ shown: ['d'], hidden: 4 })
  })

  it('more people speaking than the limit: all of them show', () => {
    expect(visibleCameras(people, 2, (p) => p !== 'a')).toEqual({ shown: ['b', 'c', 'd', 'e'], hidden: 1 })
  })
})

describe('anchoredBox', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 }
  const size = { width: 300, height: 100 }

  it('grows down and right from a box in the top-left corner', () => {
    expect(anchoredBox({ x: 16, y: 16, width: 200, height: 400 }, size, area)).toEqual({ x: 16, y: 16, ...size })
  })

  it('grows up and left from a box in the bottom-right corner, keeping its edges', () => {
    const saved = { x: 1704, y: 664, width: 200, height: 400 }
    expect(anchoredBox(saved, size, area)).toEqual({ x: 1904 - 300, y: 1064 - 100, ...size })
  })

  it('works on a second monitor', () => {
    const right = { x: 1920, y: 0, width: 1920, height: 1080 }
    expect(anchoredBox({ x: 1936, y: 900, width: 100, height: 100 }, size, right)).toEqual({ x: 1936, y: 1000 - 100, ...size })
  })
})
