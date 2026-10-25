import { GripVertical, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import type { HeldBadge, Me } from '../lib/api'
import { badgeTitle, featuredBadges, MAX_FEATURED, withFeatured } from '../store/badges'
import { BadgeIcon, NameMarks, useShownBadges } from './Badge'
import { BadgeInventory, useBadgeCount } from './BadgeInventory'
import { labelClass } from './ui'

/** The held badges with a featured list applied (null: no choice, the automatic pick). */
export function withPositions(badges: HeldBadge[], featured: string[] | null): HeldBadge[] {
  return badges.map((b) => ({ ...b, featured_position: featured && featured.includes(b.key) ? featured.indexOf(b.key) : null }))
}

/**
 * Editar perfil › Insígnias: the row next to your name (drag to reorder, × to take one out,
 * back to automatic) with a live preview of the name, and the inventory with "Destacar".
 * `featured` is the draft (null: automatic); it's saved with the rest of the profile.
 */
export function FeaturedBadgesEditor({
  user,
  featured,
  onChange
}: {
  /** The preview user: the draft's name and color, with the draft's featured badges. */
  user: Me
  featured: string[] | null
  onChange(featured: string[] | null): void
}): ReactNode {
  const shown = useShownBadges(user.badges)
  const row = featuredBadges(shown)
  const keys = row.map((s) => s.key)
  const { owned, total } = useBadgeCount(user.badges)
  const [dragged, setDragged] = useState<string | null>(null)
  const [full, setFull] = useState(false)

  const add = (key: string): void => {
    const next = withFeatured(shown, key)
    setFull(!next)
    if (next) onChange(next)
  }
  const remove = (key: string): void => {
    setFull(false)
    onChange(keys.filter((k) => k !== key))
  }
  const moveBefore = (key: string, target: string): void => {
    if (key === target) return
    const rest = keys.filter((k) => k !== key)
    rest.splice(rest.indexOf(target), 0, key)
    onChange(rest)
  }

  return (
    <div>
      <span className={`${labelClass} flex justify-between`}>
        Insígnias{' '}
        <span className="font-normal normal-case">
          {owned} de {total}
        </span>
      </span>
      <p className="mb-2 text-xs text-fg-muted">
        Até {MAX_FEATURED} aparecem ao lado do seu nome e no topo do cartão, na ordem que você escolher. Todas ficam visíveis
        na aba Insígnias do seu perfil.
      </p>

      <div className="rounded-control border border-line bg-main p-3">
        <div className="flex flex-wrap items-center gap-2" aria-label="Insígnias em destaque">
          {row.map((s) => (
            <span
              key={s.key}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                setDragged(s.key)
              }}
              onDragEnd={() => setDragged(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (dragged) moveBefore(dragged, s.key)
                setDragged(null)
              }}
              aria-label={badgeTitle(s)}
              className={`flex cursor-grab items-center gap-1.5 rounded-control border bg-elevated py-1 pl-1 pr-1.5 text-sm ${
                dragged === s.key ? 'border-accent opacity-60' : 'border-line'
              }`}
            >
              <GripVertical size={14} className="text-fg-subtle" aria-hidden />
              <BadgeIcon shown={s} size={24} />
              <span className="max-w-[140px] truncate font-medium">{badgeTitle(s)}</span>
              <button
                type="button"
                title="Tirar do destaque"
                aria-label={`Tirar ${badgeTitle(s)} do destaque`}
                onClick={() => remove(s.key)}
                className="rounded-item p-0.5 text-fg-muted hover:bg-main hover:text-fg"
              >
                <X size={14} />
              </button>
            </span>
          ))}
          {!row.length && <span className="text-sm text-fg-muted">Nenhuma insígnia em destaque.</span>}
          {featured !== null && (
            <button type="button" onClick={() => onChange(null)} className="ml-auto text-xs font-medium text-fg-muted hover:text-fg">
              Voltar ao automático
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-fg-subtle">
          {featured === null ? 'Automático: as 2 mais raras. Destaque uma para escolher você mesmo.' : 'Arraste para mudar a ordem.'}
        </p>
        <div className="mt-3 flex min-w-0 items-center gap-1.5 border-t border-line pt-3">
          <span className="text-xs text-fg-muted">Assim fica:</span>
          <span className="min-w-0 truncate text-sm font-semibold">{user.display_name}</span>
          <NameMarks user={user} />
        </div>
      </div>
      {full && <p role="alert" className="mt-1.5 text-sm text-danger">Já tem {MAX_FEATURED} em destaque. Tire uma antes de destacar outra.</p>}

      <div className="mt-3">
        <BadgeInventory badges={user.badges} featured={keys} onFeature={add} featureAlways />
      </div>
    </div>
  )
}
