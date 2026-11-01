/**
 * The overlay's widgets: their preferences, where they start and when each one shows. Shared by
 * the main process (the windows) and Settings; no Electron here, so it can be tested.
 */
import type {
  OverlayBounds,
  OverlayCameraLayout,
  OverlaySize,
  OverlayWidget,
  OverlayWidgetPrefs,
  OverlayWidgets
} from './types'

export const OVERLAY_WIDGETS: readonly OverlayWidget[] = ['voice', 'cameras', 'notifications']

export const isOverlayWidget = (value: unknown): value is OverlayWidget => OVERLAY_WIDGETS.includes(value as OverlayWidget)

export const anyWidgetOn = (widgets: OverlayWidgets): boolean => OVERLAY_WIDGETS.some((w) => widgets[w].enabled)

const COMMON: OverlayWidgetPrefs = { enabled: true, size: 'medium', opacity: 100, positions: {} }

export const DEFAULT_WIDGETS: OverlayWidgets = {
  voice: { ...COMMON, onlySpeaking: false },
  cameras: { ...COMMON, layout: 'vertical' },
  notifications: { ...COMMON, hideContent: false }
}

const MIN_SIZE = { width: 160, height: 80 }
const MAX_SIZE = { width: 900, height: 1000 }
/** Monitors remembered per widget; a laptop on many docks shouldn't grow the file forever. */
const MAX_POSITIONS = 8

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function cleanBounds(value: unknown): OverlayBounds | null {
  if (!value || typeof value !== 'object') return null
  const { x, y, width, height } = value as Partial<OverlayBounds>
  if (![x, y, width, height].every(isFiniteNumber)) return null
  return {
    x: Math.round(x!),
    y: Math.round(y!),
    width: Math.round(Math.min(MAX_SIZE.width, Math.max(MIN_SIZE.width, width!))),
    height: Math.round(Math.min(MAX_SIZE.height, Math.max(MIN_SIZE.height, height!)))
  }
}

function cleanPositions(value: unknown, fallback: Record<string, OverlayBounds>): Record<string, OverlayBounds> {
  if (!value || typeof value !== 'object') return fallback
  const entries = Object.entries(value).flatMap(([key, bounds]) => {
    const clean = cleanBounds(bounds)
    return clean ? [[key, clean] as const] : []
  })
  return Object.fromEntries(entries.slice(-MAX_POSITIONS))
}

const isSize = (v: unknown): v is OverlaySize => v === 'small' || v === 'medium' || v === 'large'
const isLayout = (v: unknown): v is OverlayCameraLayout => v === 'horizontal' || v === 'vertical'
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

function cleanCommon(raw: Partial<OverlayWidgetPrefs>, base: OverlayWidgetPrefs): OverlayWidgetPrefs {
  return {
    enabled: bool(raw.enabled, base.enabled),
    size: isSize(raw.size) ? raw.size : base.size,
    opacity: isFiniteNumber(raw.opacity) ? Math.round(Math.min(100, Math.max(30, raw.opacity))) : base.opacity,
    positions: cleanPositions(raw.positions, base.positions)
  }
}

/** `raw` over `base`, field by field: what's missing or invalid keeps its `base` value. */
export function cleanWidgets(raw: unknown, base: OverlayWidgets): OverlayWidgets {
  const given = (raw && typeof raw === 'object' ? raw : {}) as { [W in OverlayWidget]?: Partial<OverlayWidgets[W]> }
  const { voice = {}, cameras = {}, notifications = {} } = given
  return {
    voice: { ...cleanCommon(voice, base.voice), onlySpeaking: bool(voice.onlySpeaking, base.voice.onlySpeaking) },
    cameras: { ...cleanCommon(cameras, base.cameras), layout: isLayout(cameras.layout) ? cameras.layout : base.cameras.layout },
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

/** A vertical camera box turned on its side, so switching the layout keeps the tiles fitting. */
export function rotateBox({ positions, ...camera }: OverlayWidgets['cameras']): OverlayWidgets['cameras'] {
  const rotated = Object.entries(positions).map(([key, b]) => [key, cleanBounds({ ...b, width: b.height, height: b.width })!] as const)
  return { ...camera, positions: Object.fromEntries(rotated) }
}

const MARGIN = 16
const GAP = 8
const VOICE_BOX = { width: 260, height: 360 }
const CAMERA_BOX = { width: 200, height: 400 }
const NOTIFICATION_BOX = { width: 320, height: 240 }

/** Where a widget starts on a monitor: voice and cameras on the left, notifications on the right. */
export function defaultBounds(widget: OverlayWidget, area: OverlayBounds, layout: OverlayCameraLayout): OverlayBounds {
  const top = area.y + MARGIN
  if (widget === 'voice') return { ...VOICE_BOX, x: area.x + MARGIN, y: top }
  if (widget === 'notifications') {
    return { ...NOTIFICATION_BOX, x: area.x + area.width - NOTIFICATION_BOX.width - MARGIN, y: top }
  }
  const box = layout === 'vertical' ? CAMERA_BOX : { width: CAMERA_BOX.height, height: CAMERA_BOX.width }
  return { ...box, x: area.x + MARGIN, y: top + VOICE_BOX.height + GAP }
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
