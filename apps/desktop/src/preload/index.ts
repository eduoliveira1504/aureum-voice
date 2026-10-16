import { contextBridge, ipcRenderer } from 'electron'

import type { AureumBridge } from '../shared/types'

const bridge: AureumBridge = {
  session: {
    getRefreshToken: () => ipcRenderer.invoke('session:get-refresh-token'),
    setRefreshToken: (token) => ipcRenderer.invoke('session:set-refresh-token', token),
    isPersistent: () => ipcRenderer.invoke('session:is-persistent')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch)
  },
  system: {
    idleSeconds: () => ipcRenderer.invoke('system:idle-seconds')
  },
  screen: {
    getSources: () => ipcRenderer.invoke('screen:get-sources'),
    select: (sourceId, audio) => ipcRenderer.invoke('screen:select', sourceId, audio)
  }
}

contextBridge.exposeInMainWorld('aureum', bridge)
