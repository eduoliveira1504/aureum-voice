/** The fake preload bridge (window.aureum) every test starts with. */

import { vi } from 'vitest'

import type { AureumBridge } from '../../../shared/types'

const unsubscribe = (): (() => void) => () => {}
const bridge = {
  platform: 'win32',
  i18n: { preference: 'pt-BR', system: 'pt-BR' },
  media: { access: async () => 'granted', openSettings: async () => {} },
  session: { getRefreshToken: async () => null, setRefreshToken: async () => {}, isPersistent: async () => true },
  settings: {
    get: async () => ({ apiUrl: 'http://test', closeToTray: true, openAtLogin: true, loginStart: 'window', trayHintShown: true, language: 'pt-BR' as const }),
    set: async () => ({ apiUrl: 'http://test', closeToTray: true, openAtLogin: true, loginStart: 'window', trayHintShown: true, language: 'pt-BR' as const })
  },
  attachments: { get: async () => null, put: async () => {}, clear: async () => {} },
  window: { setTitleBarColors: async () => {}, capture: async () => new Uint8Array(), show: vi.fn(async () => {}) },
  callWindow: { getPinned: async () => true, setPinned: vi.fn(async () => {}), move: vi.fn(async () => {}) },
  app: { info: async () => ({ version: '0.0.0-test', os: 'Test OS' }), recentLogs: async () => '', onReportProblem: unsubscribe, ready: async () => {} },
  ptt: { watch: async () => true, onHeld: unsubscribe },
  updates: { getState: async () => ({ ready: false, version: null }), check: async () => {}, install: async () => {}, onReady: unsubscribe },
  tray: { setState: async () => {}, onCommand: unsubscribe },
  system: { idleSeconds: async () => 0 },
  games: {
    getPrefs: async () => ({ enabled: false, custom: [], hidden: [], manual: null }),
    setPrefs: async () => ({ enabled: false, custom: [], hidden: [], manual: null }),
    known: async () => [],
    running: async () => [],
    current: async () => null,
    onChange: unsubscribe
  },
  screen: { getSources: async () => [], select: async () => {}, systemAudio: async () => true },
  images: { copy: vi.fn(async () => {}), save: vi.fn(async () => true) },
  overlay: {
    // Never answers by default: tests that need the overlay state set the store themselves.
    getState: vi.fn(() => new Promise<never>(() => {})),
    setPrefs: vi.fn(),
    setEditing: async () => {},
    setActive: async () => {},
    setNotifying: async () => {},
    setCameraCount: async () => {},
    stopSharing: async () => {},
    setBounds: async () => {},
    snap: async () => {},
    pauseShortcuts: async () => {},
    answer: async () => {},
    setAskHovered: async () => {},
    onState: unsubscribe
  }
} satisfies AureumBridge

Object.defineProperty(window, 'aureum', { value: bridge, writable: true })
