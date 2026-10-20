/**
 * Automatic updates from the GitHub releases of the public repository (electron-updater).
 * Checks when the app opens and every 6 hours, downloads in the background and then tells the
 * window, which offers "Reiniciar para atualizar". Releases ship only latest.yml: a "-beta.N"
 * version allows prereleases, looks for beta.yml first and falls back to latest.yml. Installed
 * app only.
 */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

import type { UpdateState } from '../shared/types'

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

let state: UpdateState = { ready: false, version: null }

export function getUpdateState(): UpdateState {
  return state
}

export function startUpdater(onReady: (state: UpdateState) => void): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  // Without "Reiniciar", the update still goes in when the app quits for real.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = {
    info: (message) => console.info('[updater]', message),
    warn: (message) => console.warn('[updater]', message),
    error: (message) => console.error('[updater]', message),
    debug: () => {}
  }
  autoUpdater.on('update-downloaded', (info) => {
    state = { ready: true, version: info.version }
    onReady(state)
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
  if (state.ready) autoUpdater.quitAndInstall(true, true)
}
