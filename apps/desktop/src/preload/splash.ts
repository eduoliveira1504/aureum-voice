import { contextBridge, ipcRenderer } from 'electron'

import type { SplashBridge } from '../shared/types'

// The loading screen only shows what the main process tells it; it can't ask for anything.
const bridge: SplashBridge = {
  onStatus: (listener) => {
    const wrapped = (_: unknown, text: string): void => listener(text)
    ipcRenderer.on('splash:status', wrapped)
    return () => ipcRenderer.removeListener('splash:status', wrapped)
  },
  onLeave: (listener) => {
    const wrapped = (): void => listener()
    ipcRenderer.on('splash:leave', wrapped)
    return () => ipcRenderer.removeListener('splash:leave', wrapped)
  }
}

contextBridge.exposeInMainWorld('aureumSplash', bridge)
