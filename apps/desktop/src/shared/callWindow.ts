/**
 * The detached call window (block 3.20 B): rules shared by the main process (which owns the window)
 * and the renderer (which opens it with window.open and draws into it).
 */
import type { OverlayBounds } from './types'

/** The app opens it as window.open('about:blank', 'aureum-call-<n>'), unique so a window still
 *  closing is never reused; the main process lets only that name through. */
export const CALL_FRAME_NAME = 'aureum-call'

export function isCallFrame(frameName: string): boolean {
  return /^aureum-call-\d+$/.test(frameName)
}

export const CALL_WINDOW_MIN = { width: 240, height: 135 }
export const CALL_WINDOW_DEFAULT = { width: 400, height: 260 }
/** Distance from the work area's edges when placed by default. */
const MARGIN = 24
/** Larger than any monitor setup; anything beyond is a corrupt file. */
const MAX_SIZE = 16_384

export interface CallWindowPrefs {
  /** Last position and size, in screen coordinates (which also say the monitor). */
  bounds: OverlayBounds | null
  /** Stays above other windows (on by default; the header's pin turns it off). */
  pinned: boolean
}

export const DEFAULT_CALL_WINDOW_PREFS: CallWindowPrefs = { bounds: null, pinned: true }

type Area = { x: number; y: number; width: number; height: number }

/** Whole numbers within sane limits, or null for anything else (a hand-edited or corrupt file). */
export function cleanCallBounds(value: unknown): OverlayBounds | null {
  if (!value || typeof value !== 'object') return null
  const { x, y, width, height } = value as Record<string, unknown>
  const nums = [x, y, width, height]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const [bx, by, bw, bh] = (nums as number[]).map(Math.round)
  if (Math.abs(bx) > MAX_SIZE || Math.abs(by) > MAX_SIZE) return null
  return {
    x: bx,
    y: by,
    width: Math.min(MAX_SIZE, Math.max(CALL_WINDOW_MIN.width, bw)),
    height: Math.min(MAX_SIZE, Math.max(CALL_WINDOW_MIN.height, bh))
  }
}

export function cleanCallWindowPrefs(value: unknown): CallWindowPrefs {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return { bounds: cleanCallBounds(raw['bounds']), pinned: raw['pinned'] !== false }
}

/** Bottom-right of the main monitor's work area. */
export function defaultCallBounds(primary: Area): OverlayBounds {
  const width = Math.min(CALL_WINDOW_DEFAULT.width, primary.width)
  const height = Math.min(CALL_WINDOW_DEFAULT.height, primary.height)
  return {
    x: primary.x + primary.width - width - MARGIN,
    y: primary.y + primary.height - height - MARGIN,
    width,
    height
  }
}

/**
 * Where the window opens: where it was, if that spot is still on a monitor (its center inside some
 * work area); otherwise (monitor unplugged, resolution changed) the default spot on the main one.
 * A saved size bigger than its monitor shrinks to fit.
 */
export function restoreCallBounds(saved: OverlayBounds | null, areas: Area[], primary: Area): OverlayBounds {
  if (!saved) return defaultCallBounds(primary)
  const cx = saved.x + saved.width / 2
  const cy = saved.y + saved.height / 2
  const area = areas.find((a) => cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height)
  if (!area) return defaultCallBounds(primary)
  return fit(saved, area)
}

/** Keeps the box inside the area, smaller if it doesn't fit. */
function fit(box: OverlayBounds, area: Area): OverlayBounds {
  const width = Math.max(CALL_WINDOW_MIN.width, Math.min(box.width, area.width))
  const height = Math.max(CALL_WINDOW_MIN.height, Math.min(box.height, area.height))
  const x = Math.min(Math.max(box.x, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(box.y, area.y), area.y + area.height - height)
  return { x, y, width, height }
}
