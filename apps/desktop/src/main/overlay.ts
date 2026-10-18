/**
 * In-game overlay: a separate transparent, frameless, always-on-top window over the game
 * (borderless/windowed only — exclusive fullscreen is out of reach without injecting into the
 * game, which anti-cheats flag and we never do).
 *
 * The app's window opens it with window.open() and renders into it (same process, so it shares
 * the call's state and video tracks); this module owns everything about the window itself:
 * its flags, when it shows, edit mode, the global shortcuts and the saved preferences.
 */
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { app, BrowserWindow, globalShortcut, screen, type BrowserWindowConstructorOptions } from 'electron'

import type { OverlayBounds, OverlayCorner, OverlayPrefs, OverlayState } from '../shared/types'

/** The app opens the overlay as window.open(url, 'aureum-overlay-<n>'), unique so a window still
 *  closing is never reused; any other popup stays denied. */
export const isOverlayFrame = (frameName: string): boolean => /^aureum-overlay-\d+$/.test(frameName)

export const OVERLAY_WINDOW_OPTIONS: BrowserWindowConstructorOptions = {
  show: false,
  frame: false,
  transparent: true,
  backgroundColor: '#00000000',
  hasShadow: false,
  resizable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  skipTaskbar: true,
  // Never takes focus from the game; edit mode turns this on while it lasts.
  focusable: false,
  title: 'Aureum Voice — overlay'
}

const DEFAULT_PREFS: OverlayPrefs = {
  enabled: true,
  // Ctrl+Shift+F-keys: games and the usual overlays/recorders (Steam, NVIDIA, AMD, Xbox Game
  // Bar) leave them alone, and unlike Ctrl+Alt+letter they don't eat AltGr characters.
  toggleShortcut: 'Control+Shift+F9',
  editShortcut: 'Control+Shift+F10',
  bounds: null,
  size: 'medium',
  opacity: 100,
  showCameras: true,
  onlySpeaking: false
}

const MARGIN = 16
const DEFAULT_SIZE = { width: 260, height: 360 }
const MIN_SIZE = { width: 160, height: 80 }
const MAX_SIZE = { width: 900, height: 1000 }

const prefsPath = (): string => join(app.getPath('userData'), 'overlay.json')

let prefs: OverlayPrefs = { ...DEFAULT_PREFS }
let win: BrowserWindow | null = null
let editing = false
/** A call is going on (told by the app's window). */
let active = false
let mainFocused = true
let shortcutsPaused = false
let failedShortcuts: string[] = []
let notice: string | null = null
let noticeTimer: NodeJS.Timeout | null = null
/** Set while "Overlay escondido" shows: when it ends, the overlay turns off. */
let pendingOff = false
let saveTimer: NodeJS.Timeout | null = null
let notify: (state: OverlayState) => void = () => {}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

const MODIFIERS = new Set(['Control', 'Alt', 'Shift'])
const PRINTABLE_KEY = /^[A-Z0-9]$/
const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/
const NAVIGATION_KEY = /^(Insert|Delete|Home|End|PageUp|PageDown)$/

/** Accepts "Mod+Mod+Key" combos that can't get in the way of typing or of a game's own keys. */
export function isSafeShortcut(accelerator: string): boolean {
  const parts = accelerator.split('+')
  const key = parts.pop() ?? ''
  if (parts.some((m) => !MODIFIERS.has(m)) || new Set(parts).size !== parts.length) return false
  // Shift+letter is just a capital letter: letters and digits need Ctrl or Alt.
  if (PRINTABLE_KEY.test(key)) return parts.includes('Control') || parts.includes('Alt')
  // Ctrl+Insert / Shift+Insert / Shift+Delete are copy, paste and cut everywhere, and Ctrl+Home
  // etc. move the cursor: navigation keys need two modifiers.
  if (NAVIGATION_KEY.test(key)) return parts.length >= 2
  if (!FUNCTION_KEY.test(key)) return false
  // A bare F5 is a game key; F13-F24 don't exist on most keyboards (macro keys).
  return parts.length > 0 || /^F(1[3-9]|2[0-4])$/.test(key)
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function cleanBounds(value: unknown): OverlayBounds | null {
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

function cleanPrefs(raw: Partial<OverlayPrefs>, base: OverlayPrefs): OverlayPrefs {
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
  const shortcut = (v: unknown, fallback: string): string => (typeof v === 'string' && isSafeShortcut(v) ? v : fallback)
  return {
    enabled: bool(raw.enabled, base.enabled),
    toggleShortcut: shortcut(raw.toggleShortcut, base.toggleShortcut),
    editShortcut: shortcut(raw.editShortcut, base.editShortcut),
    bounds: raw.bounds === null ? null : raw.bounds !== undefined ? (cleanBounds(raw.bounds) ?? base.bounds) : base.bounds,
    size: raw.size === 'small' || raw.size === 'medium' || raw.size === 'large' ? raw.size : base.size,
    opacity: isFiniteNumber(raw.opacity) ? Math.round(Math.min(100, Math.max(30, raw.opacity))) : base.opacity,
    showCameras: bool(raw.showCameras, base.showCameras),
    onlySpeaking: bool(raw.onlySpeaking, base.onlySpeaking)
  }
}

async function loadPrefs(): Promise<void> {
  try {
    prefs = cleanPrefs(JSON.parse(await readFile(prefsPath(), 'utf8')), DEFAULT_PREFS)
  } catch {
    prefs = { ...DEFAULT_PREFS }
  }
}

async function savePrefs(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(prefsPath(), JSON.stringify(prefs, null, 2))
}

/** Saves a moment after the last change: a drag moves the window many times a second. */
function saveSoon(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void savePrefs(), 500)
}

export function getState(): OverlayState {
  return { prefs, editing, failedShortcuts, notice }
}

function changed(): void {
  notify(getState())
}

export async function setPrefs(patch: Partial<OverlayPrefs>): Promise<OverlayState> {
  if (!patch || typeof patch !== 'object') throw new Error('Invalid preferences')
  for (const key of ['toggleShortcut', 'editShortcut'] as const) {
    if (patch[key] !== undefined && (typeof patch[key] !== 'string' || !isSafeShortcut(patch[key]))) {
      throw new Error('Esse atalho atrapalharia a digitação ou os jogos. Use Ctrl, Alt ou Shift com uma tecla F (ex.: Ctrl + Shift + F9), ou Ctrl/Alt com uma letra. Insert, Delete, Home, End e Page Up/Down precisam de dois modificadores (Ctrl + Insert é copiar).')
    }
  }
  const next = cleanPrefs(patch, prefs)
  if (next.toggleShortcut === next.editShortcut) throw new Error('Os dois atalhos precisam ser diferentes.')

  const shortcutsChanged = next.toggleShortcut !== prefs.toggleShortcut || next.editShortcut !== prefs.editShortcut
  if (shortcutsChanged && !shortcutsPaused) {
    globalShortcut.unregisterAll()
    const taken = [next.toggleShortcut, next.editShortcut].filter(
      (s) => s !== prefs.toggleShortcut && s !== prefs.editShortcut && !tryRegister(s, () => {})
    )
    globalShortcut.unregisterAll()
    if (taken.length) {
      registerShortcuts()
      throw new Error('Esse atalho já está sendo usado por outro programa. Escolha outro.')
    }
  }
  prefs = next
  // Turned on or off on purpose: a pending "escondido" no longer applies.
  if (patch.enabled !== undefined) pendingOff = false
  if (shortcutsChanged) registerShortcuts()
  if (!prefs.enabled) editing = false
  await savePrefs()
  apply()
  changed()
  return getState()
}

// ---------------------------------------------------------------------------
// Global shortcuts
// ---------------------------------------------------------------------------

const logPath = (): string => join(app.getPath('userData'), 'overlay.log')
const MAX_LOG_BYTES = 200_000

/** Shortcut diagnostics on this PC (registered? did the press arrive while a game had focus?). */
function log(line: string): void {
  const entry = `${new Date().toISOString()} ${line} | enabled=${prefs.enabled} editing=${editing} active=${active} appFocused=${mainFocused} window=${
    win && !win.isDestroyed() ? (win.isVisible() ? 'visible' : 'hidden') : 'none'
  }
`
  void stat(logPath())
    .then((s) => (s.size > MAX_LOG_BYTES ? writeFile(logPath(), entry) : appendFile(logPath(), entry)))
    .catch(() => appendFile(logPath(), entry))
    .catch(() => {})
}

function tryRegister(accelerator: string, callback: () => void): boolean {
  try {
    return globalShortcut.register(accelerator, () => {
      log(`pressed ${accelerator}`)
      callback()
    })
  } catch {
    return false
  }
}

function registerShortcuts(): void {
  globalShortcut.unregisterAll()
  failedShortcuts = []
  if (shortcutsPaused) return
  const bindings: [string, () => void][] = [
    [prefs.toggleShortcut, toggleFromShortcut],
    [prefs.editShortcut, () => setEditing(!editing)]
  ]
  for (const [accelerator, callback] of bindings) {
    if (!tryRegister(accelerator, callback)) failedShortcuts.push(accelerator)
  }
  log(`registered ${bindings.map(([a]) => a).join(', ')}${failedShortcuts.length ? ` — FAILED: ${failedShortcuts.join(', ')}` : ''}`)
}

const NOTICE_MS = 2200

/** Shows a message on the overlay for a moment (even outside a call), then runs `after`. */
function flash(text: string, after?: () => void): void {
  if (noticeTimer) clearTimeout(noticeTimer)
  notice = text
  apply()
  changed()
  noticeTimer = setTimeout(() => {
    noticeTimer = null
    notice = null
    after?.()
    apply()
    changed()
  }, NOTICE_MS)
}

/** The show/hide shortcut. It says what it did, since a hidden overlay looks the same as a broken one. */
function toggleFromShortcut(): void {
  const key = prefs.toggleShortcut.replace('Control', 'Ctrl')
  if (pendingOff) {
    // Pressed again while "escondido" was showing: keep it on.
    pendingOff = false
    flash('Overlay visível')
  } else if (prefs.enabled) {
    pendingOff = true
    if (editing) setEditing(false)
    flash(`Overlay escondido · ${key} mostra de novo`, () => {
      if (!pendingOff) return
      pendingOff = false
      void setPrefs({ enabled: false })
    })
  } else {
    void setPrefs({ enabled: true }).then(() =>
      flash(active ? 'Overlay visível' : 'Overlay ligado · aparece quando você estiver numa chamada')
    )
  }
}

/** Off while Settings records a new shortcut, so pressing the current one doesn't fire it. */
export function pauseShortcuts(paused: boolean): void {
  shortcutsPaused = paused
  registerShortcuts()
  changed()
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

/** Keeps the box inside the monitor it's (mostly) on, or puts it on the primary one. */
function placed(bounds: OverlayBounds | null): OverlayBounds {
  const b = bounds ?? { ...screen.getPrimaryDisplay().workArea, ...DEFAULT_SIZE }
  if (!bounds) {
    b.x += MARGIN
    b.y += MARGIN
  }
  const area = screen.getDisplayMatching(b).workArea
  const width = Math.min(b.width, area.width)
  const height = Math.min(b.height, area.height)
  return {
    x: Math.min(Math.max(b.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(b.y, area.y), area.y + area.height - height),
    width,
    height
  }
}

/** Shows, hides and switches the window between click-through and edit mode. */
function apply(): void {
  if (!win || win.isDestroyed()) return
  // Hidden while the app itself is in front: it's for when you're in another window (the game).
  const show = prefs.enabled && (editing || notice !== null || (active && !mainFocused))
  if (!show) {
    if (win.isVisible()) win.hide()
    return
  }
  win.setBounds(placed(prefs.bounds))
  win.setIgnoreMouseEvents(!editing, { forward: true })
  win.setFocusable(editing)
  // 'screen-saver' is the highest level: above borderless games that set themselves topmost.
  win.setAlwaysOnTop(true, 'screen-saver')
  if (!win.isVisible()) win.showInactive()
  if (editing) win.focus()
}

export function setEditing(next: boolean): void {
  if (next === editing) return
  editing = next
  if (editing && !prefs.enabled) {
    prefs = { ...prefs, enabled: true }
    saveSoon()
  }
  if (!editing && saveTimer) void savePrefs()
  apply()
  changed()
}

export function setActive(next: boolean): void {
  active = next
  apply()
}

export function setBounds(bounds: unknown): void {
  const clean = cleanBounds(bounds)
  if (!clean || !editing) return
  prefs = { ...prefs, bounds: placed(clean) }
  if (win && !win.isDestroyed()) win.setBounds(prefs.bounds!)
  saveSoon()
}

export async function snap(corner: OverlayCorner): Promise<void> {
  const current = placed(prefs.bounds)
  const area = screen.getDisplayMatching(current).workArea
  const left = corner.endsWith('left')
  const top = corner.startsWith('top')
  prefs = {
    ...prefs,
    bounds: {
      ...current,
      x: left ? area.x + MARGIN : area.x + area.width - current.width - MARGIN,
      y: top ? area.y + MARGIN : area.y + area.height - current.height - MARGIN
    }
  }
  await savePrefs()
  apply()
  changed()
}

/** Takes over the window the app just opened with window.open() (see isOverlayFrame). */
export function attachWindow(created: BrowserWindow): void {
  if (win && !win.isDestroyed()) win.close()
  win = created
  // Kept out of screenshots and screen sharing (Windows 10 2004+): the overlay shows other
  // people's cameras, and they didn't agree to be streamed.
  win.setContentProtection(true)
  win.on('closed', () => {
    if (win !== created) return
    win = null
    if (editing) setEditing(false)
  })
  apply()
}

export function closeWindow(): void {
  if (win && !win.isDestroyed()) win.close()
  win = null
}

/** Called when the app's own window gains or loses focus. */
export function setMainFocused(focused: boolean): void {
  mainFocused = focused
  // Clicking back into the app ends edit mode, like pressing Concluir.
  if (focused && editing) setEditing(false)
  else apply()
}

export async function startOverlay(onState: (state: OverlayState) => void): Promise<void> {
  notify = onState
  await loadPrefs()
  registerShortcuts()
  // The app's window may have asked before the saved preferences were read.
  changed()
  apply()
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    if (saveTimer) void savePrefs()
  })
}
