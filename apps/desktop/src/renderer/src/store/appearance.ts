import { create } from 'zustand'

import { api, type Theme, type UserSettings } from '../lib/api'
import { inkOn, readableOn } from '../lib/color'

export const ACCENT_PRESETS = [
  { name: 'Dourado', hex: '#E8B531' },
  { name: 'Ametista', hex: '#8B5CF6' },
  { name: 'Esmeralda', hex: '#3FBF7F' },
  { name: 'Brasa', hex: '#E06A4E' },
  { name: 'Safira', hex: '#4F8CC9' }
] as const

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  accent_color: ACCENT_PRESETS[0].hex,
  sounds: { volume: 80, events: {} }
}

const CACHE_KEY = 'aureum.appearance'
const SAVE_DELAY_MS = 400
const SURFACES = ['--bg-rail', '--bg-panel', '--bg-main', '--bg-elevated'] as const

type Resolved = 'dark' | 'light'
type Patch = Partial<Omit<UserSettings, 'sounds'>>

interface AppearanceState {
  settings: UserSettings
  resolved: Resolved
  saveError: boolean
  /** Settings from the server (sign-in or another device): replaces the local ones. */
  hydrate(settings: UserSettings): void
  /** Applies a change right away and saves it shortly after (color pickers fire a lot). */
  update(patch: Patch): void
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const resolve = (theme: Theme): Resolved => (theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : theme)

function loadCache(): UserSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveCache(settings: UserSettings): void {
  try {
    // Lets the next start (sign-in screen included) open in the right theme without a flash.
    localStorage.setItem(CACHE_KEY, JSON.stringify(settings))
  } catch {
    // Storage unavailable: the server copy still applies after sign-in.
  }
}

let surfaces: string[] = []

/** Writes the theme to <html>: data-theme picks the palette, the accent vars are computed here. */
function applyToDocument(settings: UserSettings, resolved: Resolved): void {
  const root = document.documentElement
  root.dataset.theme = resolved
  const css = getComputedStyle(root)
  surfaces = SURFACES.map((name) => css.getPropertyValue(name).trim())
  const accent = settings.accent_color
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--on-accent', inkOn(accent))
  root.style.setProperty('--accent-text', readableOn(accent, surfaces))
}

let pending: Patch | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let inFlight = 0

async function flush(): Promise<void> {
  const body = pending
  pending = null
  if (!body) return
  inFlight++
  try {
    await api<UserSettings>('/users/me/settings', { method: 'PATCH', body })
    useAppearance.setState({ saveError: false })
  } catch {
    useAppearance.setState({ saveError: true })
  } finally {
    inFlight--
  }
}

const cached = loadCache()

export const useAppearance = create<AppearanceState>()((set, get) => ({
  settings: cached,
  resolved: resolve(cached.theme),
  saveError: false,

  hydrate: (settings) => {
    // Our own saves echo back as events; ignore them while newer local edits are unsaved.
    if (pending || inFlight) return
    set({ settings, resolved: resolve(settings.theme) })
  },

  update: (patch) => {
    const settings = { ...get().settings, ...patch }
    set({ settings, resolved: resolve(settings.theme) })
    pending = { ...pending, ...patch }
    clearTimeout(timer)
    timer = setTimeout(() => void flush(), SAVE_DELAY_MS)
  }
}))

applyToDocument(cached, resolve(cached.theme))
useAppearance.subscribe(({ settings, resolved }, prev) => {
  if (settings === prev.settings && resolved === prev.resolved) return
  applyToDocument(settings, resolved)
  saveCache(settings)
})
darkQuery.addEventListener('change', () => {
  const { settings } = useAppearance.getState()
  useAppearance.setState({ resolved: resolve(settings.theme) })
})

/** Loads the signed-in user's settings from the server. */
export async function loadAppearance(): Promise<void> {
  useAppearance.getState().hydrate(await api<UserSettings>('/users/me/settings'))
}

/**
 * A user-picked color (e.g. a profile color on a name) made readable on the current theme.
 * Re-renders when the theme changes.
 */
export function useReadableColor(color: string | null | undefined): string | undefined {
  useAppearance((s) => s.resolved)
  return color ? readableOn(color, surfaces) : undefined
}
