/** Test setup: a do-nothing preload bridge, and a clean DOM after each test. */

import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// First the fake bridge, then the texts (they read the language from it). Tests read Portuguese.
import './bridge'
import '../lib/i18n'


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
