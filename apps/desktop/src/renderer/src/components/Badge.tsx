import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import type { BadgeRarity, HeldBadge } from '../lib/api'
import { badgeTitle, RARITY_LABEL, sortBadges, useBadges, type ShownBadge } from '../store/badges'

const SMALL_MAX = 32
const PROFILE_VISIBLE = 5
export const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' })

/** The rarity's name in its metal's color. */
export const RARITY_TEXT: Record<BadgeRarity, string> = {
  comum: 'text-badge-bronze',
  rara: 'text-badge-silver',
  lendaria: 'text-badge-gold',
  mitica: 'text-badge-gold'
}

function svgData(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Held badges in display order; a key the catalog doesn't know yet reloads it once. */
export function useShownBadges(held: HeldBadge[]): ShownBadge[] {
  const catalog = useBadges((s) => s.catalog)
  const unknown = held.some((h) => !catalog[h.key])
  useEffect(() => {
    if (unknown) void useBadges.getState().load()
  }, [unknown])
  return useMemo(() => sortBadges(held, catalog), [held, catalog])
}

/**
 * One badge. The art is drawn as an image (never injected as markup). Up to 32 px it uses the
 * simplified art. Mythic ones glow and shine: always (`shine="always"`, profile card and
 * tooltip) or on hover only (`"hover"`, lists).
 */
export function BadgeIcon({ shown, size, shine = 'hover' }: { shown: ShownBadge; size: number; shine?: 'always' | 'hover' }): ReactNode {
  const svg = size <= SMALL_MAX ? shown.badge.icon_svg_small : shown.badge.icon_svg
  const src = svgData(svg)
  const mythic = shown.badge.rarity === 'mitica'
  return (
    <span
      className={`relative inline-block shrink-0 ${mythic ? 'badge-mythic' : ''} ${mythic && shine === 'hover' ? 'badge-shine-hover' : ''}`}
      style={{ width: size, height: size, '--badge-mask': `url("${src}")` } as CSSProperties}
    >
      <img src={src} alt="" draggable={false} className="block h-full w-full" />
      {mythic && <span className="badge-shine" aria-hidden />}
    </span>
  )
}

/** A badge with its tooltip: name (and number), rarity, description and when it was received. */
function BadgeWithTooltip({
  shown,
  size,
  shine,
  focusable = false
}: {
  shown: ShownBadge
  size: number
  shine: 'always' | 'hover'
  /** Off inside rows that are buttons themselves (no nested focus targets). */
  focusable?: boolean
}): ReactNode {
  const ref = useRef<HTMLSpanElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const title = badgeTitle(shown)
  return (
    <span
      ref={ref}
      tabIndex={focusable ? 0 : undefined}
      aria-label={title}
      onMouseEnter={() => setAnchor(ref.current?.getBoundingClientRect() ?? null)}
      onMouseLeave={() => setAnchor(null)}
      onFocus={() => setAnchor(ref.current?.getBoundingClientRect() ?? null)}
      onBlur={() => setAnchor(null)}
      className="inline-flex rounded-item outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <BadgeIcon shown={shown} size={size} shine={shine} />
      {anchor && <BadgeTooltip shown={shown} anchor={anchor} />}
    </span>
  )
}

function BadgeTooltip({ shown, anchor }: { shown: ShownBadge; anchor: DOMRect }): ReactNode {
  const width = 240
  const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - 8)
  const below = anchor.top < 180
  const style: CSSProperties = below ? { left, top: anchor.bottom + 8, width } : { left, bottom: window.innerHeight - anchor.top + 8, width }
  return createPortal(
    <div role="tooltip" style={style} className="pointer-events-none fixed z-[60] rounded-control border border-line bg-main p-3 shadow-xl">
      <div className="flex items-center gap-3">
        <BadgeIcon shown={shown} size={56} shine="always" />
        <div className="min-w-0">
          <div className="font-display font-semibold leading-tight">{badgeTitle(shown)}</div>
          <div className={`text-xs font-semibold uppercase tracking-wide ${RARITY_TEXT[shown.badge.rarity]}`}>
            {RARITY_LABEL[shown.badge.rarity]}
          </div>
        </div>
      </div>
      {shown.badge.description && <p className="mt-2 text-sm text-fg-muted">{shown.badge.description}</p>}
      <p className="mt-1.5 text-xs text-fg-subtle">Recebida em {dateFormat.format(new Date(shown.granted_at))}</p>
    </div>,
    document.body
  )
}

/** Profile card: up to 5 badges, rarest first, then "+N" (the rest in its tooltip). */
export function BadgeList({ badges }: { badges: HeldBadge[] }): ReactNode {
  const shown = useShownBadges(badges)
  if (!shown.length) return null
  const visible = shown.slice(0, PROFILE_VISIBLE)
  const rest = shown.slice(PROFILE_VISIBLE)
  return (
    <div className="flex items-center gap-1 rounded-item bg-main/80 px-1.5 py-1">
      {visible.map((s) => (
        <BadgeWithTooltip key={s.key} shown={s} size={24} shine="always" focusable />
      ))}
      {rest.length > 0 && (
        <span title={rest.map(badgeTitle).join(', ')} className="px-0.5 text-xs font-semibold text-fg-muted">
          +{rest.length}
        </span>
      )}
    </div>
  )
}

/** Settings > Meu perfil: the badges the user holds at a glance; opens the badges page. */
export function BadgeSummary({ badges, onOpen }: { badges: HeldBadge[]; onOpen(): void }): ReactNode {
  const shown = useShownBadges(badges)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-control border border-line bg-main p-3 text-left hover:border-fg-subtle"
    >
      {shown.length ? (
        <span className="flex -space-x-1">
          {shown.slice(0, PROFILE_VISIBLE).map((s) => (
            <BadgeIcon key={s.key} shown={s} size={32} shine="always" />
          ))}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">
          {shown.length ? `${shown.length} ${shown.length === 1 ? 'insígnia' : 'insígnias'}` : 'Nenhuma insígnia ainda'}
        </span>
        <span className="block text-xs text-fg-muted">Ver todas as insígnias do Aureum</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-fg-subtle" />
    </button>
  )
}

/** Next to a name in lists (members, chat, call): the rarest badge, shining on hover. */
export function TopBadge({ badges, size = 16 }: { badges: HeldBadge[]; size?: number }): ReactNode {
  const shown = useShownBadges(badges)
  if (!shown.length) return null
  return <BadgeWithTooltip shown={shown[0]} size={size} shine="hover" />
}
