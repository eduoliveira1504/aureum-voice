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
  }
}

contextBridge.exposeInMainWorld('aureum', bridge)
