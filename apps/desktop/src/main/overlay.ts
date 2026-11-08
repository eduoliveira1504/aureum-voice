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

import { app, BrowserWindow, globalShortcut, screen, type BrowserWindowConstructorOptions, type Display } from 'electron'

import { appKey, gameApps, OVERLAY_EXCEPTIONS, overGame, shareCarriesOverlay } from '../shared/overlayRule'
import {
  anchoredBox,
  anyWidgetOn,
  CAMERA_LIMITS,
  CAMERA_MIN_SIZE,
  cameraLayout,
  cleanBounds,
  cleanWidgets,
  DEFAULT_WIDGETS,
  defaultBounds,
  isOverlayWidget,
  legacyWidgets,
  OVERLAY_WIDGETS,
  pinnedCorner,
  widgetShows
} from '../shared/overlayWidgets'
import type { KnownGame, OverlayBounds, OverlayCorner, OverlayPrefs, OverlayPrefsPatch, OverlayState, OverlayWidget } from '../shared/types'
import { foregroundApp, foregroundBounds, foregroundFillsMonitor, windowApp } from './foregroundApp'
import { watchCombos } from './keyWatch'

/** The app opens each widget as window.open(url, 'aureum-overlay-<widget>-<n>'), unique so a window
 *  still closing is never reused; any other popup stays denied. */
export function widgetOfFrame(frameName: string): OverlayWidget | null {
  const widget = /^aureum-overlay-([a-z]+)-\d+$/.exec(frameName)?.[1]
  return isOverlayWidget(widget) ? widget : null
}

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
  widgets: DEFAULT_WIDGETS,
  hiddenApps: [],
  games: [],
  notGames: []
}

const FOREGROUND_POLL_MS = 1000
const MAX_APPS = 100
/** The bundled exceptions plus the app itself ("aureum voice" installed, "electron" in dev). */
const NEVER_OVER = new Set([...OVERLAY_EXCEPTIONS, appKey(process.execPath)])

const MARGIN = 16

const prefsPath = (): string => join(app.getPath('userData'), 'overlay.json')

let prefs: OverlayPrefs = { ...DEFAULT_PREFS }
const windows = new Map<OverlayWidget, BrowserWindow>()
/** The monitor the widgets are on (see activeDisplay). */
let displayId: number | null = null
let editing = false
/** A call is going on (told by the app's window). */
let active = false
/** A notification is up (told by the app's window); the only reason to look outside a call. */
let notifying = false
/** How many cameras the cameras widget draws (told by the app's window); its box fits them. */
let cameraCount = 1
/** Starts false: opened hidden at login, the window gets no focus event until it's shown. */
let mainFocused = false
let shortcutsPaused = false
let failedShortcuts: string[] = []
let notice: string | null = null
let noticeTimer: NodeJS.Timeout | null = null
/** Hidden with the show/hide shortcut for the rest of this call (the setting stays on). */
let hidden = false
/** The screen-share source going out (see setSharing) and, for a window, its program. */
let shared: { sourceId: string; app: string | null } | null = null
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
/** The unknown program filling the screen that the overlay asks about ("Isso é um jogo?"). */
let ask: string | null = null
let askTimer: NodeJS.Timeout | null = null
/** The pointer is over the question, so the overlay takes clicks for its buttons. */
let askHovered = false
/** Programs already asked about in this call; unanswered, they're asked again in the next one. */
const askedInCall = new Set<string>()
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

/** A list of program names (see appKey), or `fallback` when it isn't a list. */
function cleanApps(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  return [
    ...new Set(
      value
        .filter((v): v is string => typeof v === 'string' && /^[^\\/:*?"<>|]{1,128}$/.test(v))
        .map(appKey)
        .filter(Boolean)
    )
  ].slice(0, MAX_APPS)
}

function cleanPrefs(raw: OverlayPrefsPatch, base: OverlayPrefs): OverlayPrefs {
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
  const shortcut = (v: unknown, fallback: string): string => (typeof v === 'string' && isSafeShortcut(v) ? v : fallback)
  return {
    enabled: bool(raw.enabled, base.enabled),
    toggleShortcut: shortcut(raw.toggleShortcut, base.toggleShortcut),
    editShortcut: shortcut(raw.editShortcut, base.editShortcut),
    widgets: cleanWidgets(raw.widgets, base.widgets),
    hiddenApps: cleanApps(raw.hiddenApps, base.hiddenApps),
    games: cleanApps(raw.games, base.games),
    notGames: cleanApps(raw.notGames, base.notGames)
  }
}

async function loadPrefs(): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(prefsPath(), 'utf8'))
    const widgets = raw.widgets ?? legacyWidgets(raw, (bounds) => String(screen.getDisplayMatching(bounds).id))
    prefs = cleanPrefs({ ...raw, widgets }, DEFAULT_PREFS)
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
  return { prefs, editing, failedShortcuts, notice, ask, cameraCorner: cameraCorner(), hiddenWhileSharing: sharingHides() }
}

/** The corner the cameras' box is pinned to on the active monitor (see boxOf). */
function cameraCorner(): OverlayCorner {
  const display = activeDisplay()
  const saved = prefs.widgets.cameras.positions[String(display.id)]
  return pinnedCorner(saved, saved ? screen.getDisplayMatching(saved).workArea : display.workArea)
}

let toldCorner: OverlayCorner | null = null

/** Tells the app's window when the cameras' box got pinned to another corner (moved, other monitor). */
function tellCornerIfChanged(): void {
  if (cameraCorner() !== toldCorner) changed()
}

function changed(): void {
  const state = getState()
  toldCorner = state.cameraCorner
  notify(state)
}

export async function setPrefs(patch: OverlayPrefsPatch): Promise<OverlayState> {
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
  games = gameApps(knownGames, detectedGame, prefs.games)
  // Re-registers the hotkeys and restarts the key watch; turning the overlay off stops the watch.
  if (shortcutsChanged) registerShortcuts()
  else syncKeyWatch()
  if (!prefs.enabled || !anyWidgetOn(prefs.widgets)) editing = false
  await savePrefs()
  if (foregroundTimer) checkForeground()
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
 * Asks once a second, only in a call with the overlay on or while a notification is up, which
 * program is in front (its file name only), and shows the overlay only over games. The name is
 * compared here and dropped.
 */
function syncForegroundWatch(): void {
  const wanted = (active || notifying) && prefs.enabled && anyWidgetOn(prefs.widgets)
  if (wanted && !foregroundTimer) {
    checkForeground()
    foregroundTimer = setInterval(checkForeground, FOREGROUND_POLL_MS)
  } else if (!wanted && foregroundTimer) {
    clearInterval(foregroundTimer)
    foregroundTimer = null
    gameInFront = false
    stopAsking()
  }
}

/** Updates gameInFront (and the question about an unknown program); returns whether either changed. */
function checkForeground(): boolean {
  const app = foregroundApp()
  const game = overGame({ app, games, exceptions: NEVER_OVER, hidden: prefs.hiddenApps, gameRunning: detectedGame !== null })
  const asked = ask
  // The question goes away with the program it's about.
  if (ask !== null && app !== ask) stopAsking()
  if (!game && ask === null && mayAsk(app) && foregroundFillsMonitor()) startAsking(app)
  const moved = (game || ask !== null) && followWindowInFront()
  if (game === gameInFront && ask === asked && !moved) return false
  gameInFront = game
  apply()
  if (ask !== asked) changed()
  return true
}

/** The widgets go to the monitor of the game in front; returns whether that's a different one. */
function followWindowInFront(): boolean {
  const rect = foregroundBounds()
  if (!rect) return false
  const id = screen.getDisplayMatching(screen.screenToDipRect(null, rect)).id
  if (id === displayId) return false
  displayId = id
  return true
}

/** An unknown program the user never answered about, in a call where the overlay could show. */
function mayAsk(app: string | null): app is string {
  return (
    app !== null &&
    active &&
    !mainFocused &&
    !hidden &&
    anyWidgetOn(prefs.widgets) &&
    !NEVER_OVER.has(app) &&
    !prefs.hiddenApps.includes(app) &&
    !prefs.notGames.includes(app) &&
    !askedInCall.has(app)
  )
}

const ASK_MS = 20_000

/** Asks once, without turning anything on: unanswered, the question leaves after a while. */
function startAsking(app: string): void {
  ask = app
  askedInCall.add(app)
  askTimer = setTimeout(() => {
    stopAsking()
    apply()
    changed()
  }, ASK_MS)
}

function stopAsking(): void {
  if (askTimer) clearTimeout(askTimer)
  askTimer = null
  ask = null
  askHovered = false
}

/** "Mostrar" adds the program to the games with overlay; "Não é jogo" never asks about it again. */
export async function answer(isGame: boolean): Promise<void> {
  const app = ask
  if (app === null) return
  stopAsking()
  await setPrefs(isGame ? { games: [...prefs.games, app] } : { notGames: [...prefs.notGames, app] })
}

/** The overlay window tells when the pointer is over the question's buttons. */
export function setAskHovered(hovered: boolean): void {
  const next = hovered && ask !== null
  if (next === askHovered) return
  askHovered = next
  apply()
}

/** games.ts tells the known games (the list or the user's changed) and the game it detects. */
export function setGames(known: KnownGame[], detected: string | null): void {
  knownGames = known
  detectedGame = detected
  games = gameApps(knownGames, detectedGame, prefs.games)
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

/** The monitor the widgets are on: the one chosen last, or the primary one. */
function activeDisplay(): Display {
  return screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()
}

/** Placing widgets away from a game: the monitor the pointer is on (the app's, from Settings). */
function pickDisplay(): void {
  if (!gameInFront) displayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
}

/** Keeps the box inside the monitor it's (mostly) on. */
function placed(b: OverlayBounds): OverlayBounds {
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

/**
 * The widget's box on the active monitor: where it was left there, or its default place. The
 * cameras' box is as big as its cameras, pinned to the corner it was left nearest to.
 */
function boxOf(widget: OverlayWidget): OverlayBounds {
  const display = activeDisplay()
  const saved = prefs.widgets[widget].positions[String(display.id)]
  const box = saved ?? defaultBounds(widget, display.workArea)
  if (widget !== 'cameras') return placed(box)
  const cameras = prefs.widgets.cameras
  const size = cameraLayout(cameras, cameraCount, editing && cameras.enabled, display.workArea)
  // Never placed: it grows down from its default place, under the voice list.
  if (!saved) return placed({ ...box, ...size })
  return placed(anchoredBox(saved, size, screen.getDisplayMatching(saved).workArea))
}

function savePosition(widget: OverlayWidget, bounds: OverlayBounds): void {
  const widgetPrefs = prefs.widgets[widget]
  const positions = { ...widgetPrefs.positions, [String(activeDisplay().id)]: bounds }
  prefs = { ...prefs, widgets: { ...prefs.widgets, [widget]: { ...widgetPrefs, positions } } }
}

/** Shows, hides and switches each window between click-through and edit mode. */
function apply(): void {
  const hideAll = sharingHides()
  const scene = {
    editing,
    active,
    clear: !mainFocused && !hidden,
    gameInFront,
    notifying,
    notice: notice !== null,
    asking: ask !== null
  }
  for (const widget of OVERLAY_WIDGETS) {
    const win = windows.get(widget)
    if (!win || win.isDestroyed()) continue
    if (hideAll || !prefs.enabled || !widgetShows(widget, prefs.widgets, scene)) {
      if (win.isVisible()) win.hide()
      continue
    }
    const editable = editing && prefs.widgets[widget].enabled
    win.setBounds(boxOf(widget))
    // Click-through, except in edit mode and over the question's buttons (taken without focus).
    win.setIgnoreMouseEvents(!editable && !(widget === 'voice' && askHovered), { forward: true })
    win.setFocusable(editable)
    // 'screen-saver' is the highest level: above borderless games that set themselves topmost.
    win.setAlwaysOnTop(true, 'screen-saver')
    if (!win.isVisible()) win.showInactive()
  }
  // One of them takes the focus, so Esc ends edit mode; clicking another one moves it.
  if (editing) {
    const shown = [...windows.values()].filter((w) => !w.isDestroyed() && w.isVisible())
    if (!shown.some((w) => w.isFocused())) shown[0]?.focus()
  }
  // The widgets may have gone to another monitor, where the cameras sit in another corner.
  tellCornerIfChanged()
}

/**
 * The overlay hides for real while the whole screen or a game's window is streamed (3.24 A), even
 * though its windows are kept out of captures: after a hide and show, Windows can draw such a window
 * as a black box in the capture. A hidden window is never captured.
 */
function sharingHides(): boolean {
  return shareCarriesOverlay(shared?.sourceId ?? null, shared?.app ?? null, {
    games,
    exceptions: NEVER_OVER,
    hidden: prefs.hiddenApps,
    gameRunning: detectedGame !== null
  })
}

/** The source handed to a screen share (before it starts), or null when it stops. */
export function setSharing(sourceId: string | null): void {
  shared = sourceId ? { sourceId, app: sourceId.startsWith('window:') ? windowApp(sourceId) : null } : null
  if (shared && editing) setEditing(false)
  apply()
  changed()
}

export function setEditing(next: boolean): void {
  if (next === editing) return
  // Hidden while streaming: edit mode would have nothing to show (Settings says why).
  if (next && sharingHides()) return
  if (next && !anyWidgetOn(prefs.widgets)) {
    flash('Ligue um widget em Configurações › Overlay')
    return
  }
  editing = next
  if (editing) {
    hidden = false
    pickDisplay()
  }
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
  if (!active) {
    hidden = false
    shared = null
    askedInCall.clear()
  }
  syncKeyWatch()
  apply()
  changed()
}

export function setNotifying(next: boolean): void {
  if (next === notifying) return
  notifying = next
  syncForegroundWatch()
  apply()
}

export function setCameraCount(count: unknown): void {
  if (typeof count !== 'number' || !Number.isFinite(count)) return
  // "+N" goes on the last camera, so this is at most maxVisible, or more when more people are
  // speaking at once; cameraLayout keeps even a big room inside the monitor.
  const next = Math.round(Math.min(64, Math.max(CAMERA_LIMITS.maxVisible.min, count)))
  if (next === cameraCount) return
  cameraCount = next
  apply()
}

export function setBounds(widget: OverlayWidget, bounds: unknown): void {
  const clean = cleanBounds(bounds, widget === 'cameras' ? CAMERA_MIN_SIZE : undefined)
  if (!clean || !editing) return
  // The cameras' box only moves: its size is its cameras'.
  const box = placed(widget === 'cameras' ? { ...clean, width: boxOf(widget).width, height: boxOf(widget).height } : clean)
  savePosition(widget, box)
  if (widget === 'cameras') tellCornerIfChanged()
  const win = windows.get(widget)
  if (win && !win.isDestroyed()) win.setBounds(box)
  saveSoon()
}

export async function snap(widget: OverlayWidget, corner: OverlayCorner): Promise<void> {
  pickDisplay()
  const current = boxOf(widget)
  const area = screen.getDisplayMatching(current).workArea
  const left = corner.endsWith('left')
  const top = corner.startsWith('top')
  savePosition(widget, {
    ...current,
    x: left ? area.x + MARGIN : area.x + area.width - current.width - MARGIN,
    y: top ? area.y + MARGIN : area.y + area.height - current.height - MARGIN
  })
  await savePrefs()
  apply()
  changed()
}

/** Takes over the window the app just opened with window.open() (see widgetOfFrame). */
export function attachWindow(widget: OverlayWidget, created: BrowserWindow): void {
  const previous = windows.get(widget)
  if (previous && !previous.isDestroyed()) previous.close()
  windows.set(widget, created)
  // Already kept out of screenshots and screen sharing (see appWindows.ts).
  created.on('closed', () => {
    if (windows.get(widget) !== created) return
    windows.delete(widget)
    if (editing) setEditing(false)
  })
  apply()
}

export function closeWindows(): void {
  for (const win of windows.values()) if (!win.isDestroyed()) win.close()
  windows.clear()
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
