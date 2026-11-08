import { contextBridge, ipcRenderer } from 'electron'

import type { AureumBridge, OverlayState, TrayCommand, UpdateState } from '../shared/types'

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
  images: {
    copy: (png) => ipcRenderer.invoke('images:copy', png),
    save: (data, name, contentType) => ipcRenderer.invoke('images:save', data, name, contentType)
  },
  window: {
    setTitleBarColors: (color, symbolColor) => ipcRenderer.invoke('window:title-bar', color, symbolColor),
    capture: () => ipcRenderer.invoke('window:capture'),
    show: () => ipcRenderer.invoke('window:show')
  },
  callWindow: {
    getPinned: () => ipcRenderer.invoke('call-window:get-pinned'),
    setPinned: (pinned) => ipcRenderer.invoke('call-window:set-pinned', pinned),
    move: (x, y) => ipcRenderer.invoke('call-window:move', { x, y })
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    ready: (online) => ipcRenderer.invoke('app:ready', online),
    recentLogs: () => ipcRenderer.invoke('app:recent-logs'),
    onReportProblem: (listener) => {
      const wrapped = (): void => listener()
      ipcRenderer.on('app:report-problem', wrapped)
      return () => ipcRenderer.removeListener('app:report-problem', wrapped)
    }
  },
  ptt: {
    watch: (key) => ipcRenderer.invoke('ptt:watch', key),
    onHeld: (listener) => {
      const wrapped = (_: unknown, held: boolean): void => listener(held)
      ipcRenderer.on('ptt:held', wrapped)
      return () => ipcRenderer.removeListener('ptt:held', wrapped)
    }
  },
  updates: {
    getState: () => ipcRenderer.invoke('updates:get-state'),
    install: () => ipcRenderer.invoke('updates:install'),
    onReady: (listener) => {
      const wrapped = (_: unknown, state: UpdateState): void => listener(state)
      ipcRenderer.on('updates:ready', wrapped)
      return () => ipcRenderer.removeListener('updates:ready', wrapped)
    }
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
    setNotifying: (notifying) => ipcRenderer.invoke('overlay:set-notifying', notifying),
    setCameraCount: (count) => ipcRenderer.invoke('overlay:set-camera-count', count),
    stopSharing: () => ipcRenderer.invoke('overlay:stop-sharing'),
    setBounds: (widget, bounds) => ipcRenderer.invoke('overlay:set-bounds', widget, bounds),
    snap: (widget, corner) => ipcRenderer.invoke('overlay:snap', widget, corner),
    pauseShortcuts: (paused) => ipcRenderer.invoke('overlay:pause-shortcuts', paused),
    answer: (isGame) => ipcRenderer.invoke('overlay:answer', isGame),
    setAskHovered: (hovered) => ipcRenderer.invoke('overlay:set-ask-hovered', hovered),
    onState: (listener) => {
      const wrapped = (_: unknown, state: OverlayState): void => listener(state)
      ipcRenderer.on('overlay:state', wrapped)
      return () => ipcRenderer.removeListener('overlay:state', wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('aureum', bridge)
