/**
 * In-game overlay: a separate transparent, frameless, always-on-top window over the game
 * (borderless/windowed only — exclusive fullscreen is out of reach without injecting into the
 * game, which anti-cheats flag and we never do).
 *
 * The app's window opens it with window.open() and renders into it (same process, so it shares
 * the call's state and video tracks); this module owns everything about the window itself:
 * its flags, when it shows, edit mode, the global shortcuts and the saved preferences.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { app, BrowserWindow, globalShortcut, screen, type BrowserWindowConstructorOptions } from 'electron'

import { appKey, gameApps, overGame } from '../shared/overlayRule'
import type { KnownGame, OverlayBounds, OverlayCorner, OverlayPrefs, OverlayState } from '../shared/types'
import { foregroundApp } from './foregroundApp'
import { watchCombos } from './keyWatch'
// Programs that are never games (browsers, chat and music apps, launchers and game clients): the
// overlay never shows over them, even if one is added as a game by mistake. Edit the JSON to
// change the list.
import overlayExceptions from './overlayExceptions.json'

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
  onlySpeaking: false,
  hiddenApps: []
}

const FOREGROUND_POLL_MS = 1000
const MAX_HIDDEN_APPS = 100
/** The bundled exceptions plus the app itself ("aureum voice" installed, "electron" in dev). */
const NEVER_OVER = new Set([...overlayExceptions.map(appKey), appKey(process.execPath)])

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
/** Hidden with the show/hide shortcut for the rest of this call (the setting stays on). */
let hidden = false
/** Stops the key watch (see keyWatch.ts); null while it isn't running. */
let stopWatch: (() => void) | null = null
/** Polls the program in front (see foregroundApp.ts); null while it isn't running. */
let foregroundTimer: NodeJS.Timeout | null = null
/** The program in front is a game (see shared/overlayRule.ts). */
let gameInFront = false
/** The known games (bundled + the user's) and the one game detection found, from games.ts. */
let knownGames: KnownGame[] = []
let detectedGame: string | null = null
let games = new Set<string>()
const lastFired = new Map<string, number>()
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
    onlySpeaking: bool(raw.onlySpeaking, base.onlySpeaking),
    hiddenApps: Array.isArray(raw.hiddenApps)
      ? [
          ...new Set(
            raw.hiddenApps
              .filter((v): v is string => typeof v === 'string' && /^[^\\/:*?"<>|]{1,128}$/.test(v))
              .map(appKey)
              .filter(Boolean)
          )
        ].slice(0, MAX_HIDDEN_APPS)
      : base.hiddenApps
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
  // Re-registers the hotkeys and restarts the key watch; turning the overlay off stops the watch.
  if (shortcutsChanged) registerShortcuts()
  else syncKeyWatch()
  if (!prefs.enabled) editing = false
  await savePrefs()
  apply()
  changed()
  return getState()
}

// ---------------------------------------------------------------------------
// Global shortcuts
// ---------------------------------------------------------------------------

function tryRegister(accelerator: string, callback: () => void): boolean {
  try {
    return globalShortcut.register(accelerator, callback)
  } catch {
    return false
  }
}

/**
 * Runs a shortcut's action once per press. A press can arrive twice: from the Windows hotkey and
 * from the key watch (which also sees it outside games).
 */
function fire(action: 'toggle' | 'edit'): void {
  const now = Date.now()
  if (now - (lastFired.get(action) ?? 0) < 400) return
  lastFired.set(action, now)
  if (action === 'toggle') toggleFromShortcut()
  else setEditing(!editing)
}

/**
 * Windows hotkeys: the system tells us only when the exact combo is pressed (no keyboard reading).
 * Some games turn them off while focused; the key watch below covers that.
 */
function registerShortcuts(): void {
  globalShortcut.unregisterAll()
  failedShortcuts = []
  if (!shortcutsPaused) {
    for (const [accelerator, action] of [
      [prefs.toggleShortcut, 'toggle'],
      [prefs.editShortcut, 'edit']
    ] as const) {
      if (!tryRegister(accelerator, () => fire(action))) failedShortcuts.push(accelerator)
    }
  }
  syncKeyWatch()
}

/**
 * Reads the shortcuts' own keys (and no others) only while in a call with the overlay on, so the
 * shortcuts work in games that block Windows hotkeys. Stopped at any other time.
 */
function syncKeyWatch(): void {
  syncForegroundWatch()
  stopWatch?.()
  stopWatch = null
  if (!active || !prefs.enabled || shortcutsPaused) return
  stopWatch = watchCombos([
    { accelerator: prefs.toggleShortcut, onPress: () => fire('toggle') },
    { accelerator: prefs.editShortcut, onPress: () => fire('edit') }
  ])
}

/**
 * Asks once a second, only in a call with the overlay on, which program is in front (its file
 * name only), and shows the overlay only over games. The name is compared here and dropped.
 */
function syncForegroundWatch(): void {
  const wanted = active && prefs.enabled
  if (wanted && !foregroundTimer) {
    checkForeground()
    foregroundTimer = setInterval(checkForeground, FOREGROUND_POLL_MS)
  } else if (!wanted && foregroundTimer) {
    clearInterval(foregroundTimer)
    foregroundTimer = null
    gameInFront = false
  }
}

/** Updates gameInFront; returns whether it changed. */
function checkForeground(): boolean {
  const app = foregroundApp()
  const game = overGame({ app, games, exceptions: NEVER_OVER, hidden: prefs.hiddenApps, gameRunning: detectedGame !== null })
  if (game === gameInFront) return false
  gameInFront = game
  apply()
  return true
}

/** games.ts tells the known games (the list or the user's changed) and the game it detects. */
export function setGames(known: KnownGame[], detected: string | null): void {
  knownGames = known
  detectedGame = detected
  games = gameApps(knownGames, detectedGame, [])
  if (foregroundTimer) checkForeground()
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

/**
 * The show/hide shortcut hides the overlay for the rest of the call; the on/off setting lives in
 * Settings. It says what it did, since a hidden overlay looks the same as a broken one.
 */
function toggleFromShortcut(): void {
  const key = prefs.toggleShortcut.replace('Control', 'Ctrl')
  if (!prefs.enabled) {
    void setPrefs({ enabled: true }).then(() =>
      flash(active ? 'Overlay ligado' : 'Overlay ligado · aparece quando você estiver numa chamada')
    )
  } else if (!active) {
    flash('O overlay aparece quando você estiver numa chamada')
  } else {
    hidden = !hidden
    if (hidden && editing) setEditing(false)
    flash(hidden ? `Overlay escondido · ${key} mostra de novo` : 'Overlay visível')
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
  // Over a game only: hidden while the app itself, a browser, a launcher or any other app is in front.
  const show =
    prefs.enabled && (editing || notice !== null || (active && !mainFocused && !hidden && gameInFront))
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
  if (editing) hidden = false
  if (editing && !prefs.enabled) {
    prefs = { ...prefs, enabled: true }
    saveSoon()
    syncKeyWatch()
  }
  if (!editing && saveTimer) void savePrefs()
  apply()
  changed()
}

export function setActive(next: boolean): void {
  if (next === active) return
  active = next
  // A new call starts with the overlay showing again.
  if (!active) hidden = false
  syncKeyWatch()
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
  // Leaving the app for a game shows the overlay right away, not on the next poll.
  else if (focused || !foregroundTimer || !checkForeground()) apply()
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
    stopWatch?.()
    if (foregroundTimer) clearInterval(foregroundTimer)
    if (saveTimer) void savePrefs()
  })
}
