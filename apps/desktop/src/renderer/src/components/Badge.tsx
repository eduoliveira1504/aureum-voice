import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import type { BadgeRarity, HeldBadge, User } from '../lib/api'
import { badgeTitle, featuredBadges, RARITY_LABEL, sortBadges, useBadges, type ShownBadge } from '../store/badges'

const SMALL_MAX = 32
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
      className="inline-flex shrink-0 rounded-item outline-none focus-visible:ring-2 focus-visible:ring-accent"
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

/**
 * Top of the profile card: the featured badges (or the two rarest), then "+N" for the rest,
 * which are all in the card's Insígnias tab (`onMore` opens it).
 */
export function BadgeList({ badges, onMore }: { badges: HeldBadge[]; onMore?: () => void }): ReactNode {
  const shown = useShownBadges(badges)
  if (!shown.length) return null
  const visible = featuredBadges(shown)
  const rest = shown.length - visible.length
  return (
    <div className="flex items-center gap-1 rounded-item bg-main/80 px-1.5 py-1">
      {visible.map((s) => (
        <BadgeWithTooltip key={s.key} shown={s} size={24} shine="always" focusable />
      ))}
      {rest > 0 && (
        <button
          type="button"
          disabled={!onMore}
          onClick={onMore}
          title="Ver todas as insígnias"
          className="rounded-item px-0.5 text-xs font-semibold text-fg-muted enabled:hover:text-fg"
        >
          +{rest}
        </button>
      )}
    </div>
  )
}

/**
 * Next to a name in lists (members, chat, call, mentions): the featured badges in the person's
 * order, or the two rarest without a choice; shining on hover.
 */
export function TopBadges({ badges, size = 16 }: { badges: HeldBadge[]; size?: number }): ReactNode {
  const shown = useShownBadges(badges)
  if (!shown.length) return null
  return (
    <>
      {featuredBadges(shown).map((s) => (
        <BadgeWithTooltip key={s.key} shown={s} size={size} shine="hover" />
      ))}
    </>
  )
}

/** A short hint on hover or focus, like the badges' tooltip but just a line of text. */
function WithHint({ hint, children }: { hint: string; children: ReactNode }): ReactNode {
  const ref = useRef<HTMLSpanElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const show = (): void => setAnchor(ref.current?.getBoundingClientRect() ?? null)
  return (
    <span
      ref={ref}
      aria-label={hint}
      onMouseEnter={show}
      onMouseLeave={() => setAnchor(null)}
      className="inline-flex shrink-0 items-center"
    >
      {children}
      {anchor &&
        createPortal(
          <div
            role="tooltip"
            style={{ left: anchor.left + anchor.width / 2, top: anchor.top < 48 ? anchor.bottom + 8 : anchor.top - 8 }}
            className={`pointer-events-none fixed z-[60] -translate-x-1/2 ${anchor.top < 48 ? '' : '-translate-y-full'} whitespace-nowrap rounded-item border border-line bg-main px-2 py-1 text-xs font-medium text-fg shadow-xl`}
          >
            {hint}
          </div>,
          document.body
        )}
    </span>
  )
}

/** The gold check of verified accounts: a hexagon like the badges' frame, with a tick. */
export function VerifiedMark({ size = 16 }: { size?: number }): ReactNode {
  return (
    <WithHint hint="Conta verificada">
      <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden className="block shrink-0 text-badge-gold">
        <polygon
          points="48,10 80.9,29 80.9,67 48,86 15.1,67 15.1,29"
          className="fill-badge-gold/20"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinejoin="round"
        />
        <path d="M31 49 L43 61 L66 36" fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </WithHint>
  )
}

/** The small "BOT" tag of the Aureum's automated accounts. */
export function BotTag(): ReactNode {
  return (
    <WithHint hint="Conta automatizada do Aureum">
      <span className="rounded-[4px] border border-line bg-elevated px-1 text-[10px] font-bold leading-[14px] tracking-wide text-fg-muted">
        BOT
      </span>
    </WithHint>
  )
}

/**
 * Everything that follows a name: verified check, "BOT" tag, then the featured badges
 * (`badges={false}` where the badges show elsewhere, like the profile card). It never shrinks:
 * the name before it is what gets cut with an ellipsis.
 */
export function NameMarks({
  user,
  size = 16,
  badges = true
}: {
  user: Pick<User, 'badges' | 'is_verified' | 'is_bot'>
  size?: number
  badges?: boolean
}): ReactNode {
  if (!user.is_verified && !user.is_bot && (!badges || !user.badges.length)) return null
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {user.is_verified && <VerifiedMark size={size} />}
      {user.is_bot && <BotTag />}
      {badges && <TopBadges badges={user.badges} size={size} />}
    </span>
  )
}
