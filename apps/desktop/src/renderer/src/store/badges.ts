import { create } from 'zustand'

import { api, type Badge, type BadgeRarity, type HeldBadge } from '../lib/api'

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
