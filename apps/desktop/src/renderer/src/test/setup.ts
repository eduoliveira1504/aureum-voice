/** Test setup: a do-nothing preload bridge, and a clean DOM after each test. */

import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

import type { AureumBridge } from '../../../shared/types'

const unsubscribe = (): (() => void) => () => {}
const bridge = {
  session: { getRefreshToken: async () => null, setRefreshToken: async () => {}, isPersistent: async () => true },
  settings: {
    get: async () => ({ apiUrl: 'http://test', closeToTray: true, openAtLogin: true, trayHintShown: true }),
    set: async () => ({ apiUrl: 'http://test', closeToTray: true, openAtLogin: true, trayHintShown: true })
  },
  attachments: { get: async () => null, put: async () => {}, clear: async () => {} },
  window: { setTitleBarColors: async () => {}, capture: async () => new Uint8Array() },
  app: { info: async () => ({ version: '0.0.0-test', os: 'Test OS' }), recentLogs: async () => '', onReportProblem: unsubscribe },
  ptt: { watch: async () => true, onHeld: unsubscribe },
  updates: { getState: async () => ({ ready: false, version: null }), install: async () => {}, onReady: unsubscribe },
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
  screen: { getSources: async () => [], select: async () => {} },
  overlay: {
    getState: vi.fn(),
    setPrefs: vi.fn(),
    setEditing: async () => {},
    setActive: async () => {},
    setBounds: async () => {},
    snap: async () => {},
    pauseShortcuts: async () => {},
    answer: async () => {},
    setAskHovered: async () => {},
    onState: unsubscribe
  }
} satisfies AureumBridge

Object.defineProperty(window, 'aureum', { value: bridge, writable: true })

// jsdom lacks these; the app only needs them not to throw.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false
})) as typeof window.matchMedia
Element.prototype.scrollIntoView ??= () => {}
// Noise suppression loads WebAssembly and audio worklets, which only exist in a real browser;
// tests never start a call.
vi.mock('../lib/micProcessor', () => ({ MIC_PROCESSOR: 'aureum-mic', PROCESSING_RATE: 48000, MicProcessor: class {} }))

afterEach(() => cleanup())
