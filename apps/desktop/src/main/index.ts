import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { app, BrowserWindow, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from 'electron'

import type { AppSettings } from '../shared/types'

const DEFAULT_SETTINGS: AppSettings = { apiUrl: 'http://localhost:8000' }

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
    backgroundColor: '#1e1f22',
    title: 'Aureum Voice',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))

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
  contents.setWindowOpenHandler(({ url }) => {
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
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
