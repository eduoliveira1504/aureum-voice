import { Download, RefreshCw, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { api } from '../lib/api'
import { DOWNLOAD_PAGE, type UpdateState } from '../../../shared/types'
import { isNewer } from '../../../shared/version'

/**
 * The update bar under the top bar (block 4.1.4): hard to miss, and never installs by itself.
 * - The updater downloaded a version: "Reiniciar agora" (on the Mac: "Baixar", it can't update
 *   itself).
 * - Safety net: the API says which version is out. If it's newer than this one, the updater is
 *   asked to check now; if it failed, or still hasn't delivered after DELIVERY_GRACE_MS, the bar
 *   offers the download page instead.
 * "Depois" hides it until the app opens again (or a newer version comes).
 */

export const API_CHECK_MS = 3 * 60 * 60 * 1000
export const DELIVERY_GRACE_MS = 60 * 60 * 1000

export type UpdateOffer = { kind: 'restart' | 'download'; version: string } | null

/** What the bar offers, from the updater's state and the version the API says is out. */
export function offerFor(
  updater: UpdateState,
  installed: string | null,
  latest: { version: string; seenAt: number } | null,
  now: number
): UpdateOffer {
  if (updater.ready && updater.version) return { kind: updater.manual ? 'download' : 'restart', version: updater.version }
  if (!installed || !latest || !isNewer(latest.version, installed)) return null
  const undelivered = updater.failed || now - latest.seenAt >= DELIVERY_GRACE_MS
  return undelivered ? { kind: 'download', version: latest.version } : null
}

// Per app run: "Depois" lasts until the app opens again.
let dismissed: string | null = null

export function resetUpdateBarForTests(): void {
  dismissed = null
}

export function UpdateBar(): ReactNode {
  const [updater, setUpdater] = useState<UpdateState>({ ready: false, version: null })
  const [installed, setInstalled] = useState<string | null>(null)
  const [latest, setLatest] = useState<{ version: string; seenAt: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [hidden, setHidden] = useState<string | null>(dismissed)

  useEffect(() => {
    void window.aureum.updates.getState().then(setUpdater)
    void window.aureum.app.info().then((info) => setInstalled(info.version))
    return window.aureum.updates.onReady(setUpdater)
  }, [])

  useEffect(() => {
    if (!installed) return
    const ask = (): void => {
      api<{ version: string | null }>('/public/latest-version', { auth: false }).then(
        ({ version }) => {
          setNow(Date.now())
          if (!version || !isNewer(version, installed)) return
          setLatest((prev) => (prev?.version === version ? prev : { version, seenAt: Date.now() }))
          void window.aureum.updates.check()
        },
        () => {} // API unreachable: the updater is still on it
      )
    }
    ask()
    const timer = setInterval(ask, API_CHECK_MS)
    // Re-evaluates the delivery grace even without news.
    const tick = setInterval(() => setNow(Date.now()), 5 * 60 * 1000)
    return () => {
      clearInterval(timer)
      clearInterval(tick)
    }
  }, [installed])

  const offer = offerFor(updater, installed, latest, now)
  if (!offer || hidden === offer.version) return null
  const later = (): void => {
    dismissed = offer.version
    setHidden(offer.version)
  }
  const act = (): void => {
    if (offer.kind === 'restart' || updater.manual) void window.aureum.updates.install()
    else window.open(DOWNLOAD_PAGE)
  }

  return (
    <div role="status" aria-label="Atualização do Aureum" className="app-no-drag flex shrink-0 items-center gap-3 bg-accent px-4 py-2 text-sm text-on-accent">
      {offer.kind === 'restart' ? <RefreshCw size={16} className="shrink-0" /> : <Download size={16} className="shrink-0" />}
      <span className="min-w-0 flex-1 truncate font-medium">
        {offer.kind === 'restart'
          ? `A versão ${offer.version} do Aureum está pronta. Reinicie para usar.`
          : `Saiu a versão ${offer.version} do Aureum. Baixe e instale por cima desta.`}
      </span>
      <button type="button" onClick={act} className="shrink-0 rounded-control bg-main px-3 py-1 text-xs font-semibold text-fg hover:bg-elevated">
        {offer.kind === 'restart' ? 'Reiniciar agora' : 'Baixar agora'}
      </button>
      <button type="button" onClick={later} className="flex shrink-0 items-center gap-1 rounded-control px-2 py-1 text-xs font-medium hover:bg-main/20" aria-label="Depois">
        Depois <X size={14} />
      </button>
    </div>
  )
}
