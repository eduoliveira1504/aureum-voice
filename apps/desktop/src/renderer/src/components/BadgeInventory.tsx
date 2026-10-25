import { Lock, Star } from 'lucide-react'
import { useEffect, useMemo, type ReactNode } from 'react'

import type { Badge, HeldBadge } from '../lib/api'
import { badgeTitle, RARITY_LABEL, RARITY_RANK, sortBadges, useBadges, type ShownBadge } from '../store/badges'
import { BadgeIcon, dateFormat, RARITY_TEXT } from './Badge'

/** Every badge of the Aureum: the person's own first (rarest first), then the rest, locked. */
function useInventory(badges: HeldBadge[]): { badge: Badge; held: ShownBadge | null }[] {
  const catalog = useBadges((s) => s.catalog)
  useEffect(() => void useBadges.getState().load(), [])
  return useMemo(() => {
    const owned = sortBadges(badges, catalog)
    const keys = new Set(owned.map((s) => s.key))
    const locked = Object.values(catalog)
      .filter((b) => !keys.has(b.key))
      // Ones that can still be earned before the ones that can't.
      .sort((a, b) => Number(a.available === false) - Number(b.available === false) || RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity])
    return [...owned.map((s) => ({ badge: s.badge, held: s })), ...locked.map((badge) => ({ badge, held: null }))]
  }, [badges, catalog])
}

/**
 * The full inventory, open to anyone who sees the profile. On your own, `onFeature` adds a
 * "Destacar" button to each badge you have (on hover or focus in the card, always in the editor);
 * `featured` are the ones next to your name.
 */
export function BadgeInventory({
  badges,
  compact = false,
  featured,
  onFeature,
  featureAlways = false
}: {
  badges: HeldBadge[]
  /** The profile card's tab: smaller cards in a narrow column. */
  compact?: boolean
  featured?: string[]
  onFeature?: (key: string) => void
  featureAlways?: boolean
}): ReactNode {
  const cards = useInventory(badges)
  return (
    <ul className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 gap-3 sm:grid-cols-3'}`}>
      {cards.map(({ badge, held }) => (
        <BadgeCard
          key={badge.key}
          badge={badge}
          held={held}
          compact={compact}
          featured={!!featured?.includes(badge.key)}
          onFeature={held && onFeature ? () => onFeature(badge.key) : undefined}
          featureAlways={featureAlways}
        />
      ))}
    </ul>
  )
}

/** How many of the catalog the person has. */
export function useBadgeCount(badges: HeldBadge[]): { owned: number; total: number } {
  const cards = useInventory(badges)
  return { owned: cards.filter((c) => c.held).length, total: cards.length }
}

/** Why a badge you don't have is locked: what earns it, or that nobody can earn it anymore. */
function lockedText(badge: Badge): string {
  if (badge.available === false) return 'Não disponível mais'
  if (badge.how_to_get) return badge.how_to_get
  return badge.exclusive_beta ? 'Só durante o beta' : 'Ainda não é sua'
}

function BadgeCard({
  badge,
  held,
  compact,
  featured,
  onFeature,
  featureAlways
}: {
  badge: Badge
  held: ShownBadge | null
  compact: boolean
  featured: boolean
  onFeature?: () => void
  featureAlways: boolean
}): ReactNode {
  const shown: ShownBadge = held ?? { key: badge.key, number: null, granted_at: '', badge }
  return (
    <li
      aria-label={held ? badgeTitle(shown) : `${badge.name} (não tem)`}
      className={`group relative flex flex-col items-center rounded-control border text-center ${compact ? 'p-2.5' : 'p-4'} ${
        held ? 'border-line bg-main' : 'border-dashed border-line bg-transparent'
      }`}
    >
      <span className={held ? '' : 'opacity-35 grayscale'}>
        <BadgeIcon shown={shown} size={compact ? 44 : 64} shine={held ? 'always' : 'hover'} />
      </span>
      <span className={`mt-2 font-display font-semibold leading-tight ${compact ? 'text-sm' : ''} ${held ? '' : 'text-fg-muted'}`}>
        {held ? badgeTitle(shown) : badge.name}
      </span>
      <span className={`text-[11px] font-semibold uppercase tracking-wide ${RARITY_TEXT[badge.rarity]}`}>
        {RARITY_LABEL[badge.rarity]}
        {badge.exclusive_beta && ' · Beta'}
      </span>
      {badge.description && held && <span className="mt-1 text-xs text-fg-muted">{badge.description}</span>}
      <span className="mt-1.5 text-[11px] text-fg-subtle">
        {held ? (
          `Recebida em ${dateFormat.format(new Date(held.granted_at))}`
        ) : (
          <span className="inline-flex items-start gap-1">
            <Lock size={11} className="mt-0.5 shrink-0" /> {lockedText(badge)}
          </span>
        )}
      </span>
      {featured && (
        <span title="Em destaque no perfil" className="absolute right-1.5 top-1.5 text-accent-text">
          <Star size={14} fill="currentColor" aria-label="Em destaque" />
        </span>
      )}
      {onFeature && !featured && (
        <button
          type="button"
          onClick={onFeature}
          className={`rounded-control bg-accent py-1 text-xs font-semibold text-on-accent hover:bg-accent-hover ${
            featureAlways ? 'mt-2 w-full' : 'absolute inset-x-2 bottom-2 opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
          }`}
        >
          Destacar
        </button>
      )}
    </li>
  )
}
