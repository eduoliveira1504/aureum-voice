/**
 * Automatic updates from the GitHub releases of the public repository (electron-updater).
 * Checks when the app opens and every 6 hours, downloads in the background and then tells the
 * window, which shows its update bar ("Reiniciar agora"). The first check also feeds the loading
 * screen (onPhase, see startup.ts), which installs an update found while it's up, before the app
 * opens. Releases ship only latest.yml: a "-beta.N" version allows prereleases, looks for beta.yml
 * first and falls back to latest.yml. Installed app only.
 *
 * Block 4.1.4: everything the updater does goes to logs/updater.log (updaterLog.ts), and a failed
 * check or download is tried again after RETRY_MS instead of waiting for the next 6-hour check.
 * The window learns about a failure too (`failed`), so it can offer the download page.
 *
 * macOS (block 3.21, 0045): an ad-hoc signed app can't update itself. There it only checks
 * (latest-mac.yml), never downloads, and a newer version is reported as `manual`: the window offers
 * "Baixar a versão X", which opens the download page. The loading screen doesn't wait for it.
 */
import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'

import { DOWNLOAD_PAGE, type UpdateState } from '../shared/types'
import { isOfflineError, type UpdatePhase } from './startup'
import { logUpdater } from './updaterLog'

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
export const RETRY_MS = 30 * 60 * 1000

let state: UpdateState = { ready: false, version: null }
let retryTimer: ReturnType<typeof setTimeout> | undefined
let checkNow: () => void = () => {}

export function getUpdateState(): UpdateState {
  return state
}

/** Checks again right away (the loading screen, once the connection is back). */
export function checkForUpdatesNow(): void {
  checkNow()
}

/** Starts checking (installed app only). onPhase hears every step: what the loading screen shows. */
export function startUpdater(onReady: (state: UpdateState) => void, onPhase: (phase: UpdatePhase) => void = () => {}): void {
  if (!app.isPackaged) return
  const manual = process.platform === 'darwin'
  autoUpdater.autoDownload = !manual
  // Without "Reiniciar", the update still goes in when the app quits for real.
  autoUpdater.autoInstallOnAppQuit = !manual
  autoUpdater.logger = {
    info: (message) => {
      console.info('[updater]', message)
      logUpdater('info', String(message))
    },
    warn: (message) => {
      console.warn('[updater]', message)
      logUpdater('warn', String(message))
    },
    error: (message) => {
      console.error('[updater]', message)
      logUpdater('error', String(message))
    },
    debug: () => {}
  }
  let loggedPercent = -1
  autoUpdater.on('checking-for-update', () => logUpdater('info', `checking (installed ${app.getVersion()})`))
  /** A check went through: an earlier failure no longer stands. */
  const recovered = (): void => {
    if (!state.failed) return
    state = { ...state, failed: false }
    onReady(state)
  }
  autoUpdater.on('update-available', (info) => {
    logUpdater('info', `update available: ${info.version}`)
    recovered()
    if (!manual) return onPhase({ kind: 'downloading', percent: 0 })
    state = { ready: true, version: info.version, manual: true }
    onReady(state)
    onPhase({ kind: 'none' })
  })
  autoUpdater.on('download-progress', (progress) => {
    // A line every 25%, not every chunk.
    const step = Math.floor(progress.percent / 25) * 25
    if (step > loggedPercent) {
      loggedPercent = step
      logUpdater('info', `downloading: ${step}%`)
    }
    onPhase({ kind: 'downloading', percent: progress.percent })
  })
  autoUpdater.on('update-not-available', () => {
    logUpdater('info', 'up to date')
    recovered()
    onPhase({ kind: 'none' })
  })
  autoUpdater.on('error', (err) => {
    const offline = isOfflineError(err)
    logUpdater('error', `failed${offline ? ' (offline)' : ''}: ${err?.message ?? String(err)}`)
    loggedPercent = -1
    if (!state.ready) {
      state = { ...state, failed: true }
      onReady(state)
    }
    onPhase({ kind: 'failed', offline })
    // Try again soon instead of at the next 6-hour check.
    clearTimeout(retryTimer)
    retryTimer = setTimeout(check, RETRY_MS)
  })
  autoUpdater.on('update-downloaded', (info) => {
    logUpdater('info', `downloaded: ${info.version}`)
    clearTimeout(retryTimer)
    state = { ready: true, version: info.version }
    onReady(state)
    onPhase({ kind: 'downloaded' })
  })
  const check = (): void => {
    // Failures arrive as the 'error' event too, which logs them and schedules the retry.
    autoUpdater.checkForUpdates().catch((err) => console.warn('[updater] check failed', String(err)))
  }
  checkNow = check
  check()
  setInterval(check, CHECK_EVERY_MS)
}

/** Quits and installs the downloaded update silently, in the same folder; the app reopens on it. */
export function installUpdate(): void {
  logUpdater('info', state.manual ? 'opening the download page' : `installing ${state.version}`)
  if (state.manual) void shell.openExternal(DOWNLOAD_PAGE)
  else if (state.ready) autoUpdater.quitAndInstall(true, true)
}
