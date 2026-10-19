import { ArrowLeft, Lock } from 'lucide-react'
import { useEffect, useMemo, type ReactNode } from 'react'

import type { Badge, HeldBadge } from '../lib/api'
import { badgeTitle, RARITY_LABEL, RARITY_RANK, useBadges, type ShownBadge } from '../store/badges'
import { BadgeIcon, dateFormat, RARITY_TEXT } from './Badge'

/**
 * Settings > Meu perfil > Insígnias: every badge of the Aureum, the user's own first and lit, the
 * rest dimmed with what earns them (or that they were beta-only). Rarest first within each group.
 */
export function BadgesPage({ badges, onBack }: { badges: HeldBadge[]; onBack(): void }): ReactNode {
  const catalog = useBadges((s) => s.catalog)
  useEffect(() => void useBadges.getState().load(), [])
  const cards = useMemo(() => {
    const held = new Map(badges.map((h) => [h.key, h]))
    const byRarity = (a: Badge, b: Badge): number => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity]
    const all = Object.values(catalog).sort(byRarity)
    return [...all.filter((b) => held.has(b.key)), ...all.filter((b) => !held.has(b.key))].map((badge) => ({
      badge,
      held: held.get(badge.key) ?? null
    }))
  }, [badges, catalog])
  const owned = cards.filter((c) => c.held).length

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft size={16} /> Meu perfil
      </button>
      <h3 className="font-display text-xl font-semibold">Insígnias</h3>
      <p className="mt-1 text-sm text-fg-muted">
        A moldura hexagonal é a cara das insígnias do Aureum, e o metal mostra a raridade:{' '}
        <span className="font-semibold text-badge-bronze">bronze</span> é comum,{' '}
        <span className="font-semibold text-badge-silver">prata</span> é rara e{' '}
        <span className="font-semibold text-badge-gold">ouro</span> é lendária ou mítica. Você tem {owned} de {cards.length}.
      </p>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map(({ badge, held }) => (
          <BadgeCard key={badge.key} badge={badge} held={held} />
        ))}
      </ul>
    </div>
  )
}

function BadgeCard({ badge, held }: { badge: Badge; held: HeldBadge | null }): ReactNode {
  const shown: ShownBadge = held ? { ...held, badge } : { key: badge.key, number: null, granted_at: '', badge }
  return (
    <li
      aria-label={held ? badgeTitle(shown) : `${badge.name} (você não tem)`}
      className={`flex flex-col items-center rounded-control border p-4 text-center ${
        held ? 'border-line bg-main' : 'border-dashed border-line bg-transparent'
      }`}
    >
      <span className={held ? '' : 'opacity-35 grayscale'}>
        <BadgeIcon shown={shown} size={64} shine={held ? 'always' : 'hover'} />
      </span>
      <span className={`mt-3 font-display font-semibold ${held ? '' : 'text-fg-muted'}`}>{held ? badgeTitle(shown) : badge.name}</span>
      <span className={`text-xs font-semibold uppercase tracking-wide ${RARITY_TEXT[badge.rarity]}`}>
        {RARITY_LABEL[badge.rarity]}
        {badge.exclusive_beta && ' · Beta'}
      </span>
      {badge.description && <span className="mt-1.5 text-xs text-fg-muted">{badge.description}</span>}
      <span className="mt-2 text-[11px] text-fg-subtle">
        {held ? (
          `Recebida em ${dateFormat.format(new Date(held.granted_at))}`
        ) : (
          <span className="inline-flex items-center gap-1">
            <Lock size={11} /> {badge.exclusive_beta ? 'Só durante o beta' : 'Ainda não é sua'}
          </span>
        )}
      </span>
    </li>
  )
}
