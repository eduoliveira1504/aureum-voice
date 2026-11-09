/**
 * Automatic updates from the GitHub releases of the public repository (electron-updater).
 * Checks when the app opens and every 6 hours, downloads in the background and then tells the
 * window, which offers "Reiniciar para atualizar". The first check also feeds the loading screen
 * (onPhase, see startup.ts), which restarts into a version downloaded while it's up. Releases ship
 * only latest.yml: a "-beta.N"
 * version allows prereleases, looks for beta.yml first and falls back to latest.yml. Installed
 * app only.
 *
 * macOS (block 3.21, 0045): an ad-hoc signed app can't update itself. There it only checks
 * (latest-mac.yml), never downloads, and a newer version is reported as `manual`: the window offers
 * "Baixar a versão X", which opens the download page. The loading screen doesn't wait for it.
 */
import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'

import { DOWNLOAD_PAGE, type UpdateState } from '../shared/types'
import { isOfflineError, type UpdatePhase } from './startup'

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

let state: UpdateState = { ready: false, version: null }

export function getUpdateState(): UpdateState {
  return state
}

/** Starts checking (installed app only). onPhase hears every step: what the loading screen shows. */
export function startUpdater(onReady: (state: UpdateState) => void, onPhase: (phase: UpdatePhase) => void = () => {}): void {
  if (!app.isPackaged) return
  const manual = process.platform === 'darwin'
  autoUpdater.autoDownload = !manual
  // Without "Reiniciar", the update still goes in when the app quits for real.
  autoUpdater.autoInstallOnAppQuit = !manual
  autoUpdater.logger = {
    info: (message) => console.info('[updater]', message),
    warn: (message) => console.warn('[updater]', message),
    error: (message) => console.error('[updater]', message),
    debug: () => {}
  }
  autoUpdater.on('update-available', (info) => {
    if (!manual) return onPhase({ kind: 'downloading', percent: 0 })
    state = { ready: true, version: info.version, manual: true }
    onReady(state)
    onPhase({ kind: 'none' })
  })
  autoUpdater.on('download-progress', (progress) => onPhase({ kind: 'downloading', percent: progress.percent }))
  autoUpdater.on('update-not-available', () => onPhase({ kind: 'none' }))
  autoUpdater.on('error', (err) => onPhase({ kind: 'failed', offline: isOfflineError(err) }))
  autoUpdater.on('update-downloaded', (info) => {
    state = { ready: true, version: info.version }
    onReady(state)
    onPhase({ kind: 'downloaded' })
  })
  const check = (): void => {
    // Offline or GitHub unreachable: try again at the next check.
    autoUpdater.checkForUpdates().catch((err) => console.warn('[updater] check failed', String(err)))
  }
  check()
  setInterval(check, CHECK_EVERY_MS)
}

/** Quits and installs the downloaded update silently, in the same folder; the app reopens on it. */
export function installUpdate(): void {
  if (state.manual) void shell.openExternal(DOWNLOAD_PAGE)
  else if (state.ready) autoUpdater.quitAndInstall(true, true)
}
