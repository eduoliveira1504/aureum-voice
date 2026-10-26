/**
 * GIFs from Klipy. Klipy's rules (docs.klipy.com/integration-requirements) have search and trending
 * called from the user's app and media loaded straight from the URLs it returns, so the app calls
 * Klipy itself with the key and anonymous customer id our API hands out (GET /gifs/config), and
 * shows the results in Klipy's order. Only what was sent and the favorites go through our API.
 */

import { create } from 'zustand'

import { api, type Gif, type GifConfig } from '../lib/api'
import type { ServerEvent } from '../lib/realtime'

const KLIPY = 'https://api.klipy.com/api/v1'
const PER_PAGE = 24

type Rendition = { url: string; width: number; height: number }
type Size = Partial<Record<'gif' | 'webp' | 'jpg' | 'mp4' | 'webm', Rendition>>

/** One item of Klipy's search/trending answer (only what the app uses). */
export interface KlipyItem {
  id: number | string
  title?: string
  type?: string
  file?: Partial<Record<'hd' | 'md' | 'sm' | 'xs', Size>>
}

/** A GIF as the app sends and stars it: MP4 (smaller) or WebP to play, a still for reduced motion. */
export function gifOf(item: KlipyItem): Gif | null {
  const size = item.file?.md ?? item.file?.sm ?? item.file?.hd
  const play = size?.mp4 ?? size?.webp ?? size?.gif
  if (!size || !play) return null
  return {
    id: String(item.id),
    title: (item.title ?? '').slice(0, 200),
    url: play.url,
    format: size.mp4 ? 'mp4' : size.webp ? 'webp' : 'gif',
    preview: (size.jpg ?? item.file?.sm?.webp)?.url ?? null,
    width: play.width,
    height: play.height
  }
}

/** The small animated version for the picker's grid. */
export function thumbOf(item: KlipyItem): Rendition | null {
  return item.file?.sm?.webp ?? item.file?.xs?.webp ?? item.file?.sm?.gif ?? null
}

export interface GifPage {
  items: KlipyItem[]
  hasNext: boolean
}

export class GifsUnavailable extends Error {}

interface GifsState {
  config: GifConfig | null
  favorites: Gif[]
  favoritesLoaded: boolean
  /** Asks our API once per session; GIFs are off when it has no key. */
  loadConfig(): Promise<GifConfig>
  /** Trending (no query) or a search, straight from Klipy. */
  search(query: string, page: number): Promise<GifPage>
  loadFavorites(): Promise<void>
  toggleFavorite(gif: Gif): Promise<void>
  applyEvent(event: ServerEvent): void
  reset(): void
}

export const useGifs = create<GifsState>()((set, get) => ({
  config: null,
  favorites: [],
  favoritesLoaded: false,

  loadConfig: async () => {
    const known = get().config
    if (known) return known
    const config = await api<GifConfig>('/gifs/config')
    set({ config })
    return config
  },

  search: async (query, page) => {
    const config = await get().loadConfig()
    if (!config.enabled || !config.app_key) throw new GifsUnavailable('off')
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(PER_PAGE),
      customer_id: config.customer_id ?? '',
      locale: config.locale,
      content_filter: config.content_filter,
      format_filter: 'mp4,webp,jpg'
    })
    const q = query.trim()
    if (q) params.set('q', q)
    let res: Response
    try {
      res = await fetch(`${KLIPY}/${encodeURIComponent(config.app_key)}/gifs/${q ? 'search' : 'trending'}?${params}`)
    } catch {
      throw new GifsUnavailable('network')
    }
    if (!res.ok) throw new GifsUnavailable(String(res.status))
    const body = (await res.json().catch(() => null)) as { data?: { data?: KlipyItem[]; has_next?: boolean } } | null
    if (!body?.data) throw new GifsUnavailable('answer')
    // Klipy's order as is; anything that isn't a GIF (an ad slot, if ever turned on) can't be shown.
    return { items: (body.data.data ?? []).filter((i) => !i.type || i.type === 'gif'), hasNext: !!body.data.has_next }
  },

  loadFavorites: async () => {
    const favorites = await api<Gif[]>('/gifs/favorites')
    set({ favorites, favoritesLoaded: true })
  },

  toggleFavorite: async (gif) => {
    const before = get().favorites
    const starred = before.some((f) => f.id === gif.id)
    set({ favorites: starred ? before.filter((f) => f.id !== gif.id) : [gif, ...before] })
    try {
      await api(`/gifs/favorites/${encodeURIComponent(gif.id)}`, starred ? { method: 'DELETE' } : { method: 'PUT', body: gif })
    } catch (err) {
      set({ favorites: before })
      throw err
    }
  },

  applyEvent: (event) => {
    if (event.type === 'gifs.favorites') set({ favorites: event.data.favorites, favoritesLoaded: true })
  },

  reset: () => set({ config: null, favorites: [], favoritesLoaded: false })
}))

/** Plays only on hover when the system asks for reduced motion. */
export const prefersReducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
