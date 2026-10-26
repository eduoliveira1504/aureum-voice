import { create } from 'zustand'

import { api, type PanelLayout, type Theme, type UserSettings } from '../lib/api'
import { inkOn, readableOn, retint } from '../lib/color'

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
  sounds: { volume: 80, events: {} },
  status: 'online',
  tab_order: [],
  closed_tabs: [],
  sidebar_collapsed: false,
  panel_layouts: {},
  user_audio: {},
  column_sizes: {},
  muted_places: [],
  official_dm: {},
  news_dismissed: null,
  emoji_tone: 0,
  recent_emojis: [],
  read_receipts: true,
  recent_stickers: [],
  soundboard_volume: 100,
  soundboard_muted: false
}

const CACHE_KEY = 'aureum.appearance'
const SAVE_DELAY_MS = 400
const SURFACES = ['--bg-rail', '--bg-panel', '--bg-main', '--bg-elevated'] as const
/** Palette colors that follow the accent's hue. Status colors keep their meaning and stay put. */
const NEUTRALS = [...SURFACES, '--border', '--text', '--text-muted'] as const

type Resolved = 'dark' | 'light'
/** Settings the server merges key by key: only changed keys are sent, null removes one. */
type Merged = 'panel_layouts' | 'user_audio' | 'column_sizes' | 'official_dm'
type Patch = Partial<Omit<UserSettings, Merged>>
/** What goes to PATCH /users/me/settings; merged settings only with the keys that changed. */
type Pending = Patch & { [K in Merged]?: Record<string, UserSettings[K][string] | null> }

interface AppearanceState {
  settings: UserSettings
  resolved: Resolved
  saveError: boolean
  /** Settings from the server (sign-in or another device): replaces the local ones. */
  hydrate(settings: UserSettings): void
  /** Applies a change right away and saves it shortly after (color pickers fire a lot). */
  update(patch: Patch): void
  /** Same, for one server's panel layout (the server merges layouts per server). */
  updateLayout(serverId: string, layout: PanelLayout): void
  /** Same, for one key of a merged setting; null removes it. */
  updateEntry<K extends Merged>(field: K, key: string, value: UserSettings[K][string] | null): void
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
let previewFrame = 0

/**
 * While a color picker is being dragged: paints the accent straight on <html>, at most once per
 * frame, with no React state, re-tint or save. data-accent-preview also pauses CSS transitions
 * (main.css). The final color goes through `update` on release, which repaints everything and
 * saves; `endAccentPreview` restores the saved color if the picker closes without a choice.
 */
export function previewAccent(accent: string): void {
  cancelAnimationFrame(previewFrame)
  previewFrame = requestAnimationFrame(() => {
    previewFrame = 0
    const root = document.documentElement
    root.dataset.accentPreview = ''
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--on-accent', inkOn(accent))
    root.style.setProperty('--accent-text', readableOn(accent, surfaces))
  })
}

export function endAccentPreview(): void {
  if (document.documentElement.dataset.accentPreview === undefined && !previewFrame) return
  const { settings, resolved } = useAppearance.getState()
  applyToDocument(settings, resolved)
}

/**
 * Writes the theme to <html>. data-theme picks the base palette in main.css (drawn around the
 * default gold); its neutrals are then re-tinted toward the user's accent, so a purple accent gets
 * purple-black backgrounds. The accent-derived vars are computed here too.
 */
function applyToDocument(settings: UserSettings, resolved: Resolved): void {
  const root = document.documentElement
  const accent = settings.accent_color
  cancelAnimationFrame(previewFrame)
  previewFrame = 0
  delete root.dataset.accentPreview
  root.dataset.theme = resolved
  for (const name of NEUTRALS) root.style.removeProperty(name) // read the base palette, not last tint
  const css = getComputedStyle(root)
  for (const name of NEUTRALS) {
    root.style.setProperty(name, retint(css.getPropertyValue(name).trim(), accent, DEFAULT_SETTINGS.accent_color))
  }
  surfaces = SURFACES.map((name) => root.style.getPropertyValue(name))
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--on-accent', inkOn(accent))
  root.style.setProperty('--accent-text', readableOn(accent, surfaces))
  // The window buttons Windows draws over the top bar follow the theme too.
  const tokens = getComputedStyle(root)
  const titleBar = toHex(tokens.getPropertyValue('--bg-rail'))
  const symbols = toHex(tokens.getPropertyValue('--text'))
  if (titleBar && symbols) void window.aureum?.window.setTitleBarColors(titleBar, symbols).catch(() => {})
}

/** "#rrggbb" for a CSS color the browser can paint (the tokens may be any CSS color syntax). */
function toHex(color: string): string | null {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx || !color.trim()) return null
  ctx.fillStyle = '#000000'
  ctx.fillStyle = color.trim()
  const value = ctx.fillStyle
  return /^#[0-9a-f]{6}$/i.test(value) ? value : null
}

let pending: Pending | null = null
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
    scheduleFlush()
  },

  updateLayout: (serverId, layout) => get().updateEntry('panel_layouts', serverId, layout),

  updateEntry: (field, key, value) => {
    const settings = get().settings
    const entries = { ...settings[field] } as Record<string, unknown>
    if (value === null) delete entries[key]
    else entries[key] = value
    set({ settings: { ...settings, [field]: entries } })
    pending = { ...pending, [field]: { ...pending?.[field], [key]: value } }
    scheduleFlush()
  }
}))

function scheduleFlush(): void {
  clearTimeout(timer)
  timer = setTimeout(() => void flush(), SAVE_DELAY_MS)
}

applyToDocument(cached, resolve(cached.theme))
useAppearance.subscribe(({ settings, resolved }, prev) => {
  if (settings === prev.settings && resolved === prev.resolved) return
  // Layout-only changes (tabs, panels) don't touch the theme.
  if (resolved !== prev.resolved || settings.accent_color !== prev.settings.accent_color) {
    applyToDocument(settings, resolved)
  }
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
