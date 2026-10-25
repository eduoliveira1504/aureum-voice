import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { arch, release } from 'node:os'
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

import appIcon from '../../build/icon.ico?asset'
import type { AppInfo, AppSettings, GamePrefs, OverlayCorner, OverlayPrefs, ShareSource, TrayCommand } from '../shared/types'
import * as attachmentCache from './attachmentCache'
import { currentGame, getPrefs, knownGames, runningApps, setPrefs, startGameDetection } from './games'
import { captureMainConsole, captureWindowConsole, recentLogs } from './logs'
import * as overlay from './overlay'
import { watchPushToTalk } from './pushToTalk'
import { createTray, destroyTray, notify, setTrayState } from './tray'
import { getUpdateState, installUpdate, startUpdater } from './updater'

captureMainConsole()

// Set at build time (apps/desktop/.env.production.local), so the installer friends get
// already points at the public server; users can still change it on the login screen.
const DEFAULT_SETTINGS: AppSettings = {
  apiUrl: import.meta.env.MAIN_VITE_API_URL || 'http://localhost:8000',
  closeToTray: true,
  openAtLogin: true,
  trayHintShown: false
}

// Started by Windows at login: stay in the tray until opened.
const startHidden = process.argv.includes('--hidden')

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
// Last settings read or written, for decisions that can't wait for the disk (closing the window).
let cachedSettings: AppSettings = { ...DEFAULT_SETTINGS }
// Set when the app really quits (tray menu, Windows shutdown): closing then doesn't just hide.
let quitting = false
// Used only when OS encryption is unavailable: the token is never written in plaintext.
let memoryRefreshToken: string | null = null

// ---------------------------------------------------------------------------
// Settings and session storage
// ---------------------------------------------------------------------------

async function readSettings(): Promise<AppSettings> {
  try {
    cachedSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(await readFile(settingsPath(), 'utf8')) }
  } catch {
    cachedSettings = { ...DEFAULT_SETTINGS }
  }
  return cachedSettings
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
  for (const key of ['closeToTray', 'openAtLogin', 'trayHintShown'] as const) {
    if (patch[key] !== undefined) next[key] = patch[key] === true
  }
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify(next, null, 2))
  cachedSettings = next
  if (patch.openAtLogin !== undefined) applyLoginItem(next.openAtLogin)
  return next
}

/** Registers (or not) the app to start with Windows, hidden in the tray. Only the installed
 * app: in development it would register the bare Electron binary. */
function applyLoginItem(open: boolean): void {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: open, args: ['--hidden'] })
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
handle('attachments:get', attachmentCache.get)
handle('attachments:put', attachmentCache.put)
handle('attachments:clear', attachmentCache.clear)
handle('tray:set-state', setTrayState)
handle('app:recent-logs', recentLogs)
handle('app:info', (): AppInfo => ({
  version: app.getVersion(),
  os: `${process.platform === 'win32' ? 'Windows' : process.platform} ${release()} (${arch()})`
}))
handle('updates:get-state', getUpdateState)
handle('updates:install', () => {
  quitting = true
  installUpdate()
})
// Seconds without keyboard/mouse input on the whole PC (not just this app), for auto-idle.
handle('system:idle-seconds', () => powerMonitor.getSystemIdleTime())

// "Jogando X": the renderer forwards only the detected game's name to the server.
handle('games:get-prefs', getPrefs)
handle('games:set-prefs', async (patch: Partial<GamePrefs>) => {
  const prefs = await setPrefs(patch)
  void syncOverlayGames()
  return prefs
})
handle('games:known', knownGames)
handle('games:running', runningApps)
handle('games:current', currentGame)

// In-game overlay (see overlay.ts). It shows only over games: the known ones and the detected one.
const syncOverlayGames = async (): Promise<void> => overlay.setGames(await knownGames(), currentGame())
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
// Push-to-talk (see pushToTalk.ts): only while the window asks for it.
handle('ptt:watch', (key: unknown) => {
  if (key !== null && typeof key !== 'string') throw new Error('Invalid key')
  return watchPushToTalk(key, (held) => mainWindow?.webContents.send('ptt:held', held))
})
handle('overlay:pause-shortcuts', (paused: unknown) => overlay.pauseShortcuts(paused === true))
handle('overlay:answer', (isGame: unknown) => overlay.answer(isGame === true))
handle('overlay:set-ask-hovered', (hovered: unknown) => overlay.setAskHovered(hovered === true))

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

const TITLE_BAR_HEIGHT = 48 // the top bar's height (h-12)
const HEX = /^#[0-9a-f]{6}$/i

handle('window:title-bar', (color: unknown, symbolColor: unknown) => {
  if (typeof color !== 'string' || !HEX.test(color) || typeof symbolColor !== 'string' || !HEX.test(symbolColor)) {
    throw new Error('Invalid colors')
  }
  mainWindow?.setTitleBarOverlay({ color, symbolColor, height: TITLE_BAR_HEIGHT })
})

handle('window:capture', async () => (await mainWindow!.webContents.capturePage()).toPNG())

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0908', // dark --bg-rail: shown before the renderer paints
    // No system title bar: the app's tab bar sits at the top, with Windows' buttons drawn over
    // its right end in the theme's colors (the renderer updates them, see window:title-bar).
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0908', symbolColor: '#f4efe4', height: TITLE_BAR_HEIGHT },
    title: 'Aureum Voice',
    icon: appIcon, // window and taskbar (the installed exe carries the same icon)
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Hidden in the tray, the app must keep its timers (WebSocket pings, calls) at full speed.
      backgroundThrottling: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow?.show()
  })
  // The X hides the window: calls, messages and notifications keep going in the background.
  mainWindow.on('close', (event) => {
    if (quitting || !cachedSettings.closeToTray) return
    event.preventDefault()
    mainWindow?.hide()
    if (!cachedSettings.trayHintShown) {
      notify('O Aureum continua rodando na bandeja', 'Para fechar de vez, use Sair do Aureum no ícone da bandeja.')
      void writeSettings({ trayHintShown: true })
    }
  })
  captureWindowConsole(mainWindow.webContents, 'app')
  // Ctrl+Shift+R opens "Reportar problema" (in Electron's default menu it would force a reload).
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && !input.alt && input.key.toLowerCase() === 'r') {
      event.preventDefault()
      mainWindow?.webContents.send('app:report-problem')
    }
  })
  mainWindow.on('focus', () => overlay.setMainFocused(true))
  mainWindow.on('blur', () => overlay.setMainFocused(false))
  mainWindow.webContents.on('did-create-window', (created, { frameName }) => {
    if (overlay.isOverlayFrame(frameName)) overlay.attachWindow(created)
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    watchPushToTalk(null, () => {})
    // Not a child window (it would minimize along with the app), so close it by hand.
    overlay.closeWindow()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(): void {
  if (!mainWindow) return createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// Never let web content navigate away or open new windows inside the app.
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (!(devUrl && url.startsWith(devUrl))) event.preventDefault()
  })
  contents.setWindowOpenHandler(({ url, frameName }) => {
    // The app's window opens the overlay as a blank page and renders into it itself.
    if (contents === mainWindow?.webContents && overlay.isOverlayFrame(frameName) && url === 'about:blank') {
      return { action: 'allow', overrideBrowserWindowOptions: overlay.OVERLAY_WINDOW_OPTIONS }
    }
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Opening the app again brings the running one to the front (also out of the tray).
  app.on('second-instance', showWindow)
  app.on('before-quit', () => {
    quitting = true
  })

  app.whenReady().then(() => {
    // Same as electron-builder's appId, so the taskbar groups the window with the shortcut's icon.
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
    void readSettings().then((s) => applyLoginItem(s.openAtLogin))
    createWindow()
    createTray({
      open: showWindow,
      quit: () => {
        quitting = true
        app.quit()
      },
      command: (command: TrayCommand) => mainWindow?.webContents.send('tray:command', command)
    })
    void overlay.startOverlay((state) => mainWindow?.webContents.send('overlay:state', state))
    void startGameDetection((game) => {
      mainWindow?.webContents.send('games:changed', game)
      void syncOverlayGames()
    }).then(syncOverlayGames)
    startUpdater((state) => mainWindow?.webContents.send('updates:ready', state))
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('will-quit', destroyTray)
}
