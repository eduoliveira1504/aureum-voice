/**
 * The detached call window (block 3.20 B): the call in a window of its own, frameless and above the
 * other programs, that stays up with the app minimized or behind something else.
 *
 * Like the overlay, the app's window opens it with window.open() and renders into it with a React
 * portal: same process, so it shows the tracks of the call's own LiveKit room (no second
 * connection). This module owns the window itself: its flags, "fixar por cima" and the saved
 * position and size. It isn't the overlay: a normal window, so it never shows over a game in
 * exclusive fullscreen and reads nothing of the game.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { app, screen, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'

import {
  CALL_WINDOW_DEFAULT,
  CALL_WINDOW_MIN,
  cleanCallBounds,
  cleanCallWindowPrefs,
  DEFAULT_CALL_WINDOW_PREFS,
  restoreCallBounds,
  type CallWindowPrefs
} from '../shared/callWindow'

export const CALL_WINDOW_OPTIONS: BrowserWindowConstructorOptions = {
  show: false,
  frame: false,
  // The window's edges resize it (frameless windows keep Windows' resize border).
  resizable: true,
  width: CALL_WINDOW_DEFAULT.width,
  height: CALL_WINDOW_DEFAULT.height,
  minWidth: CALL_WINDOW_MIN.width,
  minHeight: CALL_WINDOW_MIN.height,
  // Double-clicking it would maximize: it's always a small window.
  maximizable: false,
  fullscreenable: false,
  backgroundColor: '#0a0908', // dark --bg-rail, before the renderer paints
  title: 'Aureum Voice — chamada'
}

const SAVE_DELAY_MS = 500
const prefsPath = (): string => join(app.getPath('userData'), 'call-window.json')

let prefs: CallWindowPrefs = { ...DEFAULT_CALL_WINDOW_PREFS }
let loaded: Promise<void> | null = null
let win: BrowserWindow | null = null
let saveTimer: NodeJS.Timeout | null = null

function load(): Promise<void> {
  loaded ??= readFile(prefsPath(), 'utf8')
    .then((text) => {
      prefs = cleanCallWindowPrefs(JSON.parse(text))
    })
    .catch(() => {})
  return loaded
}

async function save(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(prefsPath(), JSON.stringify(prefs, null, 2))
}

function saveSoon(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void save(), SAVE_DELAY_MS)
}

function applyPinned(target: BrowserWindow): void {
  // 'floating': above normal windows, below the overlay ('screen-saver') and system UI.
  target.setAlwaysOnTop(prefs.pinned, 'floating')
}

const alive = (): BrowserWindow | null => (win && !win.isDestroyed() ? win : null)

/** Takes over the window the app just opened with window.open() (see isCallFrame). */
export async function attachWindow(created: BrowserWindow): Promise<void> {
  const previous = alive()
  if (previous && previous !== created) previous.close()
  win = created
  await load()
  if (created.isDestroyed()) return
  const areas = screen.getAllDisplays().map((d) => d.workArea)
  created.setBounds(restoreCallBounds(prefs.bounds, areas, screen.getPrimaryDisplay().workArea))
  applyPinned(created)
  const remember = (): void => {
    if (created.isDestroyed() || created.isMinimized()) return
    prefs = { ...prefs, bounds: created.getBounds() }
    saveSoon()
  }
  created.on('moved', remember)
  created.on('resized', remember)
  created.on('closed', () => {
    if (win === created) win = null
    if (saveTimer) void save()
  })
  created.show()
}

export async function getPinned(): Promise<boolean> {
  await load()
  return prefs.pinned
}

export async function setPinned(pinned: boolean): Promise<void> {
  await load()
  prefs = { ...prefs, pinned }
  const current = alive()
  if (current) applyPinned(current)
  await save()
}

/** Dragged by any part of it that isn't a button: the renderer sends where the window goes. */
export function moveTo(position: unknown): void {
  const current = alive()
  if (!current || !position || typeof position !== 'object') return
  const { x, y } = position as Record<string, unknown>
  const bounds = cleanCallBounds({ ...current.getBounds(), x, y })
  if (!bounds) return
  current.setPosition(bounds.x, bounds.y)
}

export function closeWindow(): void {
  alive()?.close()
}
