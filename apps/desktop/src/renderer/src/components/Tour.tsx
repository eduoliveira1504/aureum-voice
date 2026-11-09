import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { balloonPosition, type Box, type TourStepBase } from '../lib/onboarding'
import { useAppearance } from '../store/appearance'
import { useOnboarding } from '../store/onboarding'
import { Logo } from './Logo'

/**
 * The tour's engine and the first-time tips (block 3.16): our own component, no library.
 * Elements are found by fixed anchors (data-tour="..."), never by class names; anchors.test.ts
 * fails if one used here goes missing.
 */

export interface TourStep extends TourStepBase {
  /** The data-tour value of the element to highlight; none: a balloon in the middle. */
  anchor?: string
  title: string
  text: string
  /** Label of "Próximo" on this step ("Começar" on the welcome). */
  next?: string
  /** Puts the screen where the step needs it (opens the server, the overview...). */
  prepare?(): void
}

const SPOT_PADDING = 6
/** How long a step waits for its element before it's skipped (the layout may not have it). */
const ANCHOR_WAIT_MS = 2000

export const anchorSelector = (anchor: string): string => `[data-tour="${anchor}"]`

/** The element's box on screen while `active`, followed every frame (it may move or resize);
 * null while it's missing or hidden. */
export function useAnchor(anchor: string | undefined, active: boolean): Box | null {
  // Kept with the anchor it belongs to, so a new anchor never shows the last one's box.
  const [found, setFound] = useState<{ anchor: string; box: Box } | null>(null)
  useEffect(() => {
    if (!anchor || !active) return
    let frame = 0
    let last: string | null = null
    const measure = (): void => {
      const el = document.querySelector(anchorSelector(anchor))
      const r = el?.getBoundingClientRect()
      const box = r && r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null
      const key = box ? `${box.left},${box.top},${box.width},${box.height}` : ''
      if (key !== last) {
        last = key
        setFound(box && { anchor, box })
      }
      frame = requestAnimationFrame(measure)
    }
    measure()
    return () => cancelAnimationFrame(frame)
  }, [anchor, active])
  return anchor && active && found?.anchor === anchor ? found.box : null
}

function useViewport(): { width: number; height: number } {
  const [view, setView] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const onResize = (): void => setView({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return view
}

/** A balloon placed next to `target` (or centered), measured so it never leaves the window. */
function Placed({ target, className, children }: { target: Box | null; className: string; children: ReactNode }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const view = useViewport()
  const [size, setSize] = useState({ width: 340, height: 180 })
  useLayoutEffect(() => {
    const el = ref.current
    if (el && (el.offsetWidth !== size.width || el.offsetHeight !== size.height)) {
      setSize({ width: el.offsetWidth, height: el.offsetHeight })
    }
  })
  const pos = balloonPosition(target, size, view)
  return (
    <div ref={ref} data-side={pos.side} style={{ left: pos.left, top: pos.top }} className={className}>
      {children}
    </div>
  )
}

const balloonClass =
  'fixed w-[340px] max-w-[calc(100vw-24px)] rounded-panel border border-line bg-panel p-4 text-fg shadow-2xl motion-safe:transition-[left,top] motion-safe:duration-200'

function GuideHeader({ title, badge, id }: { title: string; badge?: ReactNode; id?: string }): ReactNode {
  return (
    <div className="flex items-center gap-2.5">
      <Logo size={32} className="shrink-0 text-accent-text" />
      <h2 id={id} className="min-w-0 flex-1 font-display text-[15px] font-semibold leading-snug">
        {title}
      </h2>
      {badge}
    </div>
  )
}

const quietButton = 'rounded-control px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-elevated hover:text-fg'
const mainButton = 'rounded-control bg-accent px-3.5 py-1.5 text-sm font-semibold text-on-accent hover:bg-accent-hover'

/**
 * The tour on screen: darkens the window, lights up the step's element and shows the guide's
 * balloon. Always skippable (button and Esc); arrows go back and forth. A step whose element
 * doesn't show up in time is skipped.
 */
export function TourOverlay({ steps, news = false, onEnd }: { steps: TourStep[]; news?: boolean; onEnd(): void }): ReactNode {
  const [index, setIndex] = useState(0)
  const direction = useRef<1 | -1>(1)
  const step = steps[index]
  const nextRef = useRef<HTMLButtonElement>(null)
  const endRef = useRef(onEnd)
  endRef.current = onEnd

  const move = (delta: 1 | -1): void => {
    direction.current = delta
    const next = index + delta
    if (next >= steps.length) endRef.current()
    else if (next >= 0) setIndex(next)
  }
  const moveRef = useRef(move)
  moveRef.current = move

  useEffect(() => {
    step?.prepare?.()
  }, [step])

  const target = useAnchor(step?.anchor, !!step)
  const waiting = !!step?.anchor && !target

  useEffect(() => {
    if (!waiting) return
    // Going back from the first step can't skip backwards: go forward instead.
    const timer = setTimeout(() => moveRef.current(index === 0 ? 1 : direction.current), ANCHOR_WAIT_MS)
    return () => clearTimeout(timer)
  }, [waiting, index])

  useEffect(() => {
    if (!waiting) nextRef.current?.focus()
  }, [waiting, index])

  useEffect(() => {
    // Capture phase, ahead of the call's and the modals' own Esc.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') endRef.current()
      else if (e.key === 'ArrowRight') moveRef.current(1)
      else if (e.key === 'ArrowLeft') moveRef.current(-1)
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    if (steps.length === 0) endRef.current()
  }, [steps.length])

  if (!step) return null
  const spot = target && {
    left: target.left - SPOT_PADDING,
    top: target.top - SPOT_PADDING,
    width: target.width + SPOT_PADDING * 2,
    height: target.height + SPOT_PADDING * 2
  }
  const last = index === steps.length - 1

  return createPortal(
    // Over everything, the top bar's drag region included (Electron keeps it under layers that don't opt out).
    <div className="app-no-drag fixed inset-0 z-[70]" data-tour-overlay>
      {spot ? (
        <div
          aria-hidden
          style={{ ...spot, boxShadow: '0 0 0 200vmax color-mix(in oklab, var(--scrim) 72%, transparent)' }}
          className="pointer-events-none fixed rounded-control ring-2 ring-accent motion-safe:transition-[left,top,width,height] motion-safe:duration-300"
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-scrim/70" />
      )}
      {!waiting && (
        <Placed target={spot} className={balloonClass}>
          <div role="dialog" aria-modal="true" aria-labelledby="tour-title">
            <GuideHeader
              id="tour-title"
              title={step.title}
              badge={news && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-on-accent">Novidade</span>}
            />
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{step.text}</p>
            <div className="mt-4 flex items-center gap-1">
              <span className="mr-auto text-xs tabular-nums text-fg-subtle" aria-label={`Passo ${index + 1} de ${steps.length}`}>
                {index + 1}/{steps.length}
              </span>
              {!last && (
                <button type="button" className={quietButton} onClick={() => endRef.current()}>
                  Pular
                </button>
              )}
              {index > 0 && (
                <button type="button" className={quietButton} onClick={() => move(-1)}>
                  Voltar
                </button>
              )}
              <button ref={nextRef} type="button" className={mainButton} onClick={() => move(1)}>
                {step.next ?? (last ? 'Concluir' : 'Próximo')}
              </button>
            </div>
          </div>
        </Placed>
      )}
    </div>,
    document.body
  )
}

let tokens = 0

/**
 * A first-time tip: one balloon next to `anchor` until "Entendi", then never again (saved on the
 * server). Mount it where the thing happens (in the call, in the chat...); only one tip shows at
 * a time, never during the tour, and a tip whose element isn't on screen waits.
 */
export function FirstTimeTip({ tip, anchor, title, text }: { tip: string; anchor: string; title: string; text: string }): ReactNode {
  const token = useRef(0)
  if (!token.current) token.current = ++tokens
  const seen = useAppearance((s) => s.settings.onboarding.tips_seen.includes(tip))
  const blocked = useOnboarding((s) => !s.ready || !!s.tour || s.invite || (!!s.tip && s.tip.token !== token.current))
  const mine = useOnboarding((s) => s.tip?.token === token.current)
  const target = useAnchor(anchor, !seen && !blocked)

  useEffect(() => {
    const { claimTip, releaseTip } = useOnboarding.getState()
    if (target && !seen && !blocked) claimTip(tip, token.current)
    else if (!target) releaseTip(token.current)
  }, [target, seen, blocked, tip])

  useEffect(() => {
    const id = token.current
    return () => useOnboarding.getState().releaseTip(id)
  }, [])

  if (!mine || !target || seen) return null
  return createPortal(
    <Placed target={target} className={`${balloonClass} app-no-drag z-[65] w-[300px]`}>
      <div role="note" aria-label={`Dica: ${title}`} data-tip={tip}>
        <GuideHeader title={title} />
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">{text}</p>
        <div className="mt-3 flex justify-end">
          <button type="button" className={mainButton} onClick={() => useOnboarding.getState().dismissTip(tip)}>
            Entendi
          </button>
        </div>
      </div>
    </Placed>,
    document.body
  )
}
