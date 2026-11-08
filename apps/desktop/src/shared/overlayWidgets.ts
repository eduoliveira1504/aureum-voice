/**
 * The overlay's widgets: their preferences, where they start and when each one shows. Shared by
 * the main process (the windows) and Settings; no Electron here, so it can be tested.
 */
import type {
  OverlayBounds,
  OverlayCorner,
  OverlayCameraLayout,
  OverlayCameraPrefs,
  OverlaySize,
  OverlayWidget,
  OverlayWidgetPrefs,
  OverlayWidgets
} from './types'

export const OVERLAY_WIDGETS: readonly OverlayWidget[] = ['voice', 'cameras', 'notifications']

export const isOverlayWidget = (value: unknown): value is OverlayWidget => OVERLAY_WIDGETS.includes(value as OverlayWidget)

export const anyWidgetOn = (widgets: OverlayWidgets): boolean => OVERLAY_WIDGETS.some((w) => widgets[w].enabled)

const COMMON: OverlayWidgetPrefs = { enabled: true, size: 'medium', opacity: 100, positions: {} }

/** The width of a camera for each size shortcut: the sizes from before block 3.22 (176 px x scale). */
export const CAMERA_SIZES: Record<OverlaySize, number> = { small: 141, medium: 176, large: 229 }
export const CAMERA_LIMITS = {
  tileWidth: { min: 96, max: 360 },
  maxVisible: { min: 1, max: 8 },
  perRow: { min: 1, max: 8 },
  gap: { min: 0, max: 16 }
} as const

const DEFAULT_CAMERAS: OverlayCameraPrefs = { layout: 'vertical', tileWidth: CAMERA_SIZES.medium, maxVisible: 4, perRow: 2, gap: 6, rounded: true }

export const DEFAULT_WIDGETS: OverlayWidgets = {
  voice: { ...COMMON, onlySpeaking: false },
  cameras: { ...COMMON, ...DEFAULT_CAMERAS },
  notifications: { ...COMMON, hideContent: false }
}

const MIN_SIZE = { width: 160, height: 80 }
/** The cameras' box follows its cameras: one small camera is smaller than the other widgets' minimum. */
export const CAMERA_MIN_SIZE = { width: 48, height: 27 }
/** Up to a 4K monitor: a row of big cameras is wide. Boxes are also kept inside the monitor. */
const MAX_SIZE = { width: 3840, height: 2160 }
/** Monitors remembered per widget; a laptop on many docks shouldn't grow the file forever. */
const MAX_POSITIONS = 8

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function cleanBounds(value: unknown, min = MIN_SIZE): OverlayBounds | null {
  if (!value || typeof value !== 'object') return null
  const { x, y, width, height } = value as Partial<OverlayBounds>
  if (![x, y, width, height].every(isFiniteNumber)) return null
  return {
    x: Math.round(x!),
    y: Math.round(y!),
    width: Math.round(Math.min(MAX_SIZE.width, Math.max(min.width, width!))),
    height: Math.round(Math.min(MAX_SIZE.height, Math.max(min.height, height!)))
  }
}

function cleanPositions(value: unknown, fallback: Record<string, OverlayBounds>, min = MIN_SIZE): Record<string, OverlayBounds> {
  if (!value || typeof value !== 'object') return fallback
  const entries = Object.entries(value).flatMap(([key, bounds]) => {
    const clean = cleanBounds(bounds, min)
    return clean ? [[key, clean] as const] : []
  })
  return Object.fromEntries(entries.slice(-MAX_POSITIONS))
}

const isSize = (v: unknown): v is OverlaySize => v === 'small' || v === 'medium' || v === 'large'
const isLayout = (v: unknown): v is OverlayCameraLayout => v === 'horizontal' || v === 'vertical' || v === 'grid'
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
/** A whole number within `limits`, or `fallback` when it isn't a number. */
const whole = (v: unknown, limits: { min: number; max: number }, fallback: number): number =>
  isFiniteNumber(v) ? Math.round(Math.min(limits.max, Math.max(limits.min, v))) : fallback

/** The size shortcut nearest to a camera width. */
export function sizeOfTile(width: number): OverlaySize {
  const sizes = Object.entries(CAMERA_SIZES) as [OverlaySize, number][]
  return sizes.reduce((best, cur) => (Math.abs(cur[1] - width) < Math.abs(best[1] - width) ? cur : best))[0]
}

/**
 * The cameras' own fields. The width comes from `tileWidth` or, when only a size is given (a size
 * shortcut, or an overlay.json from before block 3.22), from that size; `size` then follows it.
 */
function cleanCameras(raw: Partial<OverlayWidgets['cameras']>, base: OverlayWidgets['cameras']): OverlayWidgets['cameras'] {
  const common = cleanCommon(raw, base, CAMERA_MIN_SIZE)
  const tileWidth = isFiniteNumber(raw.tileWidth)
    ? whole(raw.tileWidth, CAMERA_LIMITS.tileWidth, base.tileWidth)
    : isSize(raw.size)
      ? CAMERA_SIZES[raw.size]
      : base.tileWidth
  return {
    ...common,
    size: sizeOfTile(tileWidth),
    layout: isLayout(raw.layout) ? raw.layout : base.layout,
    tileWidth,
    maxVisible: whole(raw.maxVisible, CAMERA_LIMITS.maxVisible, base.maxVisible),
    perRow: whole(raw.perRow, CAMERA_LIMITS.perRow, base.perRow),
    gap: whole(raw.gap, CAMERA_LIMITS.gap, base.gap),
    rounded: bool(raw.rounded, base.rounded)
  }
}

function cleanCommon(raw: Partial<OverlayWidgetPrefs>, base: OverlayWidgetPrefs, min = MIN_SIZE): OverlayWidgetPrefs {
  return {
    enabled: bool(raw.enabled, base.enabled),
    size: isSize(raw.size) ? raw.size : base.size,
    opacity: isFiniteNumber(raw.opacity) ? Math.round(Math.min(100, Math.max(30, raw.opacity))) : base.opacity,
    positions: cleanPositions(raw.positions, base.positions, min)
  }
}

/** `raw` over `base`, field by field: what's missing or invalid keeps its `base` value. */
export function cleanWidgets(raw: unknown, base: OverlayWidgets): OverlayWidgets {
  const given = (raw && typeof raw === 'object' ? raw : {}) as { [W in OverlayWidget]?: Partial<OverlayWidgets[W]> }
  const { voice = {}, cameras = {}, notifications = {} } = given
  return {
    voice: { ...cleanCommon(voice, base.voice), onlySpeaking: bool(voice.onlySpeaking, base.voice.onlySpeaking) },
    cameras: cleanCameras(cameras, base.cameras),
    notifications: {
      ...cleanCommon(notifications, base.notifications),
      hideContent: bool(notifications.hideContent, base.notifications.hideContent)
    }
  }
}

/**
 * The widgets of an overlay.json from before block 3.14, when the overlay was one box: it becomes
 * the voice widget, in the same place, and "Mostrar câmeras" becomes the cameras widget.
 */
export function legacyWidgets(raw: Record<string, unknown>, displayOf: (bounds: OverlayBounds) => string): OverlayWidgets {
  const bounds = cleanBounds(raw.bounds)
  const look = { size: raw.size as OverlaySize, opacity: raw.opacity as number }
  return cleanWidgets(
    {
      voice: { ...look, onlySpeaking: raw.onlySpeaking as boolean, positions: bounds ? { [displayOf(bounds)]: bounds } : {} },
      cameras: { ...look, enabled: raw.showCameras as boolean }
    },
    DEFAULT_WIDGETS
  )
}

const MARGIN = 16
const GAP = 8
const VOICE_BOX = { width: 260, height: 360 }
const CAMERA_BOX = { width: 200, height: 400 }
const NOTIFICATION_BOX = { width: 320, height: 240 }

/**
 * Where a widget starts on a monitor: voice and cameras on the left, notifications on the right.
 * The cameras' size here only says where it's pinned: the box follows its cameras (cameraLayout).
 */
export function defaultBounds(widget: OverlayWidget, area: OverlayBounds): OverlayBounds {
  const top = area.y + MARGIN
  if (widget === 'voice') return { ...VOICE_BOX, x: area.x + MARGIN, y: top }
  if (widget === 'notifications') {
    return { ...NOTIFICATION_BOX, x: area.x + area.width - NOTIFICATION_BOX.width - MARGIN, y: top }
  }
  return { ...CAMERA_BOX, x: area.x + MARGIN, y: top + VOICE_BOX.height + GAP }
}

/** What decides whether a widget's window shows. */
export interface OverlayScene {
  editing: boolean
  /** In a call. */
  active: boolean
  /** Not hidden with the shortcut, and the app's own window isn't in front. */
  clear: boolean
  gameInFront: boolean
  /** A notification is up. */
  notifying: boolean
  /** A short message from a shortcut. */
  notice: boolean
  /** "Isso é um jogo?" about the program in front. */
  asking: boolean
}

/**
 * Over games only (0024). A widget switched off never shows, except that the voice window also
 * carries the shortcut's messages and the question, which aren't part of any widget.
 */
export function widgetShows(widget: OverlayWidget, widgets: OverlayWidgets, s: OverlayScene): boolean {
  const on = widgets[widget].enabled
  const overGame = s.clear && s.gameInFront
  if (widget === 'voice') {
    return s.notice || (s.active && s.clear && s.asking) || (on && (s.editing || (s.active && overGame)))
  }
  if (!on) return false
  return s.editing || (overGame && (widget === 'cameras' ? s.active : s.notifying))
}

/** Who has a camera on goes to the cameras widget; with it off, everyone stays in the voice list. */
export function splitPeople<P extends { camera?: unknown }>(people: P[], camerasOn: boolean): { voice: P[]; cameras: P[] } {
  if (!camerasOn) return { voice: people, cameras: [] }
  return { voice: people.filter((p) => !p.camera), cameras: people.filter((p) => p.camera) }
}

/** The widget box's padding around the cameras (WidgetBox's p-2). */
export const CAMERA_PADDING = 8
/** Edit mode: the bar on top (pt-11 instead of the padding) and the dashed border, both sides. */
const EDIT_TOP = 44
const EDIT_BORDER = 2
/** Edit mode: wide enough for the bar's controls even with one small camera. */
export const EDIT_MIN_WIDTH = 340
/** A camera never gets smaller than this to fit a monitor. */
const FIT_MIN_TILE = 48

export interface CameraLayout {
  columns: number
  rows: number
  tileWidth: number
  tileHeight: number
  /** The widget's box: the cameras plus padding (and the edit bar). */
  width: number
  height: number
}

/**
 * Where `count` cameras go and the size of the box around them. Too big for `area` (the monitor's
 * work area), the cameras shrink to fit instead of being cut off.
 */
export function cameraLayout(
  prefs: OverlayCameraPrefs,
  count: number,
  editing: boolean,
  area?: { width: number; height: number }
): CameraLayout {
  const n = Math.max(1, count)
  const columns = prefs.layout === 'vertical' ? 1 : prefs.layout === 'horizontal' ? n : Math.min(prefs.perRow, n)
  const rows = Math.ceil(n / columns)
  const extraW = 2 * CAMERA_PADDING + (editing ? 2 * EDIT_BORDER : 0)
  const extraH = editing ? EDIT_TOP + CAMERA_PADDING + 2 * EDIT_BORDER : 2 * CAMERA_PADDING
  let tile = prefs.tileWidth
  if (area) {
    const fitWidth = (area.width - extraW - (columns - 1) * prefs.gap) / columns
    // Whole pixels of height, so rounding the height back up never passes the monitor.
    const fitHeight = Math.floor((area.height - extraH - (rows - 1) * prefs.gap) / rows) * (16 / 9)
    tile = Math.max(FIT_MIN_TILE, Math.min(tile, fitWidth, fitHeight))
  }
  const tileWidth = Math.floor(tile)
  const tileHeight = Math.round((tileWidth * 9) / 16)
  const width = columns * tileWidth + (columns - 1) * prefs.gap + extraW
  return {
    columns,
    rows,
    tileWidth,
    tileHeight,
    width: editing ? Math.max(width, EDIT_MIN_WIDTH) : width,
    height: rows * tileHeight + (rows - 1) * prefs.gap + extraH
  }
}

/**
 * The cameras that show, in the call's order: up to `max`, always with whoever is speaking (even
 * past `max`), and how many are left out ("+N").
 */
export function visibleCameras<P>(people: P[], max: number, speaking: (p: P) => boolean): { shown: P[]; hidden: number } {
  if (people.length <= max) return { shown: people, hidden: 0 }
  const talking = people.filter(speaking)
  const quiet = people.filter((p) => !speaking(p)).slice(0, Math.max(0, max - talking.length))
  const keep = new Set([...talking, ...quiet])
  const shown = people.filter((p) => keep.has(p))
  return { shown, hidden: people.length - shown.length }
}

/** The screen corner a box is nearest to; none saved yet: top-left, where the cameras start. */
export function pinnedCorner(saved: OverlayBounds | undefined, area: OverlayBounds): OverlayCorner {
  if (!saved) return 'top-left'
  const bottom = saved.y + saved.height / 2 > area.y + area.height / 2
  const right = saved.x + saved.width / 2 > area.x + area.width / 2
  return `${bottom ? 'bottom' : 'top'}-${right ? 'right' : 'left'}`
}

/**
 * A box of `size` pinned where `saved` is: it keeps the edges of the screen corner `saved` is
 * nearest to, so it grows and shrinks away from that corner.
 */
export function anchoredBox(saved: OverlayBounds, size: { width: number; height: number }, area: OverlayBounds): OverlayBounds {
  const corner = pinnedCorner(saved, area)
  const right = corner.endsWith('right')
  const bottom = corner.startsWith('bottom')
  return {
    x: right ? saved.x + saved.width - size.width : saved.x,
    y: bottom ? saved.y + saved.height - size.height : saved.y,
    width: size.width,
    height: size.height
  }
}
