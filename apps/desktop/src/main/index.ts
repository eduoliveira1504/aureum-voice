import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  powerMonitor,
  safeStorage,
  session,
  shell,
  webContents,
  type IpcMainInvokeEvent
} from 'electron'

import type { AppSettings, GamePrefs, OverlayCorner, OverlayPrefs, ShareSource } from '../shared/types'
import { currentGame, getPrefs, knownGames, runningApps, setPrefs, startGameDetection } from './games'
import * as overlay from './overlay'

// Set at build time (apps/desktop/.env.production.local), so the installer friends get
// already points at the public server; users can still change it on the login screen.
const DEFAULT_SETTINGS: AppSettings = { apiUrl: import.meta.env.MAIN_VITE_API_URL || 'http://localhost:8000' }

// AUREUM_PROFILE=<name> runs the app with separate data (session, settings), so two
// accounts can be used side by side on one machine — handy for testing calls locally.
const profile = process.env['AUREUM_PROFILE']
if (profile && /^[\w-]{1,32}$/.test(profile)) {
  app.setPath('userData', join(app.getPath('appData'), `Aureum Voice (${profile})`))
}

// Permissions the app's own window may use; everything else is denied.
const ALLOWED_PERMISSIONS = new Set(['media', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection'])

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')
const sessionPath = (): string => join(app.getPath('userData'), 'session.bin')

let mainWindow: BrowserWindow | null = null
// Used only when OS encryption is unavailable: the token is never written in plaintext.
let memoryRefreshToken: string | null = null

// ---------------------------------------------------------------------------
// Settings and session storage
// ---------------------------------------------------------------------------

async function readSettings(): Promise<AppSettings> {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(await readFile(settingsPath(), 'utf8')) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

async function writeSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = await readSettings()
  if (patch.apiUrl !== undefined) {
    const url = new URL(patch.apiUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('API URL must use http or https')
    }
    next.apiUrl = url.origin
  }
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify(next, null, 2))
  return next
}

async function getRefreshToken(): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return memoryRefreshToken
  try {
    return safeStorage.decryptString(await readFile(sessionPath()))
  } catch {
    return null
  }
}

async function setRefreshToken(token: string | null): Promise<void> {
  if (token !== null && typeof token !== 'string') throw new Error('Invalid token')
  if (token === null) {
    memoryRefreshToken = null
    await rm(sessionPath(), { force: true })
  } else if (safeStorage.isEncryptionAvailable()) {
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(sessionPath(), safeStorage.encryptString(token))
  } else {
    memoryRefreshToken = token
  }
}

// ---------------------------------------------------------------------------
// IPC — only the app's own window may call these handlers
// ---------------------------------------------------------------------------

function handle<A extends unknown[], R>(
  channel: string,
  fn: (...args: A) => Promise<R> | R
): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('Untrusted IPC sender')
    }
    return fn(...(args as A))
  })
}

handle('session:get-refresh-token', getRefreshToken)
handle('session:set-refresh-token', setRefreshToken)
handle('session:is-persistent', () => safeStorage.isEncryptionAvailable())
handle('settings:get', readSettings)
handle('settings:set', writeSettings)
// Seconds without keyboard/mouse input on the whole PC (not just this app), for auto-idle.
handle('system:idle-seconds', () => powerMonitor.getSystemIdleTime())

// "Jogando X": the renderer forwards only the detected game's name to the server.
handle('games:get-prefs', getPrefs)
handle('games:set-prefs', (patch: Partial<GamePrefs>) => setPrefs(patch))
handle('games:known', knownGames)
handle('games:running', runningApps)
handle('games:current', currentGame)

// In-game overlay (see overlay.ts).
const CORNERS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
handle('overlay:get-state', overlay.getState)
handle('overlay:set-prefs', (patch: Partial<OverlayPrefs>) => overlay.setPrefs(patch))
handle('overlay:set-editing', (editing: unknown) => overlay.setEditing(editing === true))
handle('overlay:set-active', (active: unknown) => overlay.setActive(active === true))
handle('overlay:set-bounds', overlay.setBounds)
handle('overlay:snap', (corner: unknown) => {
  if (typeof corner !== 'string' || !CORNERS.has(corner)) throw new Error('Invalid corner')
  return overlay.snap(corner as OverlayCorner)
})
handle('overlay:pause-shortcuts', (paused: unknown) => overlay.pauseShortcuts(paused === true))

// ---------------------------------------------------------------------------
// Screen sharing — the renderer shows its own picker, then calls getDisplayMedia,
// which lands in the display-media handler below with the source it picked.
// ---------------------------------------------------------------------------

/** Source picked in the app's picker, consumed by the next getDisplayMedia call. */
let pendingShare: { sourceId: string; audio: boolean; at: number } | null = null
const PENDING_SHARE_TTL_MS = 10_000

handle('screen:get-sources', async (): Promise<ShareSource[]> => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  })
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: s.thumbnail.toDataURL(),
    icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
  }))
})

handle('screen:select', (sourceId: unknown, audio: unknown) => {
  if (typeof sourceId !== 'string') throw new Error('Invalid source')
  pendingShare = { sourceId, audio: audio === true, at: Date.now() }
})

function installDisplayMediaHandler(isAppWindow: (contents: Electron.WebContents | null) => boolean): void {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const pick = pendingShare
    pendingShare = null
    const requester = request.frame ? (webContents.fromFrame(request.frame) ?? null) : null
    if (!pick || Date.now() - pick.at > PENDING_SHARE_TTL_MS || !isAppWindow(requester)) {
      return callback(null)
    }
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
    const source = sources.find((s) => s.id === pick.sourceId)
    if (!source) return callback(null)
    // 'loopback' = system audio (Windows only).
    callback({ video: source, ...(pick.audio && request.audioRequested ? { audio: 'loopback' as const } : {}) })
  })
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0908', // dark --bg-rail: shown before the renderer paints
    title: 'Aureum Voice',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('focus', () => overlay.setMainFocused(true))
  mainWindow.on('blur', () => overlay.setMainFocused(false))
  mainWindow.webContents.on('did-create-window', (created, { frameName }) => {
    if (frameName === overlay.OVERLAY_FRAME_NAME) overlay.attachWindow(created)
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    // Not a child window (it would minimize along with the app), so close it by hand.
    overlay.closeWindow()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Never let web content navigate away or open new windows inside the app.
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (!(devUrl && url.startsWith(devUrl))) event.preventDefault()
  })
  contents.setWindowOpenHandler(({ url, frameName }) => {
    // The app's window opens the overlay as a blank page and renders into it itself.
    if (contents === mainWindow?.webContents && frameName === overlay.OVERLAY_FRAME_NAME && url === 'about:blank') {
      return { action: 'allow', overrideBrowserWindowOptions: overlay.OVERLAY_WINDOW_OPTIONS }
    }
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.aureum.voice')
    const isAppWindow = (contents: Electron.WebContents | null): boolean =>
      !!contents && contents === mainWindow?.webContents
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) =>
      callback(isAppWindow(contents) && ALLOWED_PERMISSIONS.has(permission))
    )
    session.defaultSession.setPermissionCheckHandler(
      (contents, permission) => isAppWindow(contents) && ALLOWED_PERMISSIONS.has(permission)
    )
    installDisplayMediaHandler(isAppWindow)
    createWindow()
    void overlay.startOverlay((state) => mainWindow?.webContents.send('overlay:state', state))
    void startGameDetection((game) => mainWindow?.webContents.send('games:changed', game))
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
