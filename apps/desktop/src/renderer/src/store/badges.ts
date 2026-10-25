import { create } from 'zustand'

import { api, type Badge, type BadgeRarity, type HeldBadge, type Me } from '../lib/api'

/** Rarest first, the order profiles list badges in. */
export const RARITY_RANK: Record<BadgeRarity, number> = { mitica: 0, lendaria: 1, rara: 2, comum: 3 }

export const RARITY_LABEL: Record<BadgeRarity, string> = {
  comum: 'Comum',
  rara: 'Rara',
  lendaria: 'Lendária',
  mitica: 'Mítica'
}

/** A held badge with what it looks like. */
export interface ShownBadge extends HeldBadge {
  badge: Badge
}

/** Badges without a priority (an older API) go after those with one. */
const NO_PRIORITY = 100

/**
 * Held badges the catalog knows, rarest first; within a rarity, the badge's fixed priority
 * (Fundador before Pioneiro), then the oldest first. Unknown keys (a badge newer than the
 * catalog loaded) are skipped until the catalog reloads.
 */
export function sortBadges(held: HeldBadge[], catalog: Record<string, Badge>): ShownBadge[] {
  return held
    .filter((h) => catalog[h.key])
    .map((h) => ({ ...h, badge: catalog[h.key] }))
    .sort(
      (a, b) =>
        RARITY_RANK[a.badge.rarity] - RARITY_RANK[b.badge.rarity] ||
        (a.badge.priority ?? NO_PRIORITY) - (b.badge.priority ?? NO_PRIORITY) ||
        a.granted_at.localeCompare(b.granted_at)
    )
}

/** How many badges someone may feature next to their name, and how many go there without a choice. */
export const MAX_FEATURED = 3
export const AUTO_FEATURED = 2

/** Whether the person picked their featured badges (otherwise the rarest are shown). */
export function hasChosen(held: HeldBadge[]): boolean {
  return held.some((h) => h.featured_position != null)
}

/**
 * Next to the name and at the top of the profile card: the ones the person featured, in their
 * order; without a choice, the two rarest (`shown` is sortBadges' order).
 */
export function featuredBadges(shown: ShownBadge[]): ShownBadge[] {
  if (!hasChosen(shown)) return shown.slice(0, AUTO_FEATURED)
  return shown
    .filter((s) => s.featured_position != null)
    .sort((a, b) => a.featured_position! - b.featured_position!)
    .slice(0, MAX_FEATURED)
}

/**
 * The featured list after featuring `key`: what shows next to the name now (the automatic pick,
 * if no choice yet) plus it at the end. Null when three are featured already.
 */
export function withFeatured(shown: ShownBadge[], key: string): string[] | null {
  const now = featuredBadges(shown).map((s) => s.key)
  if (now.includes(key)) return now
  return now.length < MAX_FEATURED ? [...now, key] : null
}

/** Saves the badges next to my name, in order; [] goes back to the automatic pick. */
export function saveFeatured(keys: string[]): Promise<Me> {
  return api<Me>('/users/me/badges/featured', { method: 'PUT', body: { keys } })
}

/** The badge's name as shown, with its number: "Pioneiro #7". */
export function badgeTitle(shown: ShownBadge): string {
  return shown.number !== null ? `${shown.badge.name} #${shown.number}` : shown.badge.name
}

interface BadgeCatalog {
  catalog: Record<string, Badge>
  loading: boolean
  /** Loads the catalog (on sign-in, and when a profile shows a key it doesn't know yet). */
  load(): Promise<void>
}

export const useBadges = create<BadgeCatalog>()((set, get) => ({
  catalog: {},
  loading: false,
  load: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const list = await api<Badge[]>('/badges')
      set({ catalog: Object.fromEntries(list.map((b) => [b.key, b])) })
    } catch {
      // Offline: profiles show no badges until the next load.
    } finally {
      set({ loading: false })
    }
  }
}))
