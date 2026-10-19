import { contextBridge, ipcRenderer } from 'electron'

import type { AureumBridge, OverlayState, TrayCommand } from '../shared/types'

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
  attachments: {
    get: (id) => ipcRenderer.invoke('attachments:get', id),
    put: (id, data) => ipcRenderer.invoke('attachments:put', id, data),
    clear: () => ipcRenderer.invoke('attachments:clear')
  },
  tray: {
    setState: (state) => ipcRenderer.invoke('tray:set-state', state),
    onCommand: (listener) => {
      const wrapped = (_: unknown, command: TrayCommand): void => listener(command)
      ipcRenderer.on('tray:command', wrapped)
      return () => ipcRenderer.removeListener('tray:command', wrapped)
    }
  },
  system: {
    idleSeconds: () => ipcRenderer.invoke('system:idle-seconds')
  },
  games: {
    getPrefs: () => ipcRenderer.invoke('games:get-prefs'),
    setPrefs: (patch) => ipcRenderer.invoke('games:set-prefs', patch),
    known: () => ipcRenderer.invoke('games:known'),
    running: () => ipcRenderer.invoke('games:running'),
    current: () => ipcRenderer.invoke('games:current'),
    onChange: (listener) => {
      const wrapped = (_: unknown, game: string | null): void => listener(game)
      ipcRenderer.on('games:changed', wrapped)
      return () => ipcRenderer.removeListener('games:changed', wrapped)
    }
  },
  screen: {
    getSources: () => ipcRenderer.invoke('screen:get-sources'),
    select: (sourceId, audio) => ipcRenderer.invoke('screen:select', sourceId, audio)
  },
  overlay: {
    getState: () => ipcRenderer.invoke('overlay:get-state'),
    setPrefs: (patch) => ipcRenderer.invoke('overlay:set-prefs', patch),
    setEditing: (editing) => ipcRenderer.invoke('overlay:set-editing', editing),
    setActive: (active) => ipcRenderer.invoke('overlay:set-active', active),
    setBounds: (bounds) => ipcRenderer.invoke('overlay:set-bounds', bounds),
    snap: (corner) => ipcRenderer.invoke('overlay:snap', corner),
    pauseShortcuts: (paused) => ipcRenderer.invoke('overlay:pause-shortcuts', paused),
    onState: (listener) => {
      const wrapped = (_: unknown, state: OverlayState): void => listener(state)
      ipcRenderer.on('overlay:state', wrapped)
      return () => ipcRenderer.removeListener('overlay:state', wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('aureum', bridge)
