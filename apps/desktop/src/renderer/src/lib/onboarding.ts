/**
 * Tour and first-time tips (block 3.16): the rules, without React. Progress lives in
 * user_settings.onboarding, so it follows the person to another PC or a reinstall.
 */

import type { Onboarding } from './api'

/**
 * The tour's version. When steps are added, bump it and give the new steps `since` = the new
 * version: whoever finished an older tour sees only those, marked "Novidade".
 */
export const TOUR_VERSION = 1

export interface TourStepBase {
  id: string
  /** The tour version that added this step. */
  since: number
  /** Opens a server first (the official one, or the first tab); skipped without any server. */
  needsServer?: boolean
}

/** What to do when the app opens. */
export type TourStart =
  | { kind: 'none' }
  /** A new account: the tour starts by itself. */
  | { kind: 'auto' }
  /** An account older than the tour: ask once ("Quer fazer um tour rápido pelo Aureum?"). */
  | { kind: 'invite' }
  /** Finished an older tour: only the steps added since. */
  | { kind: 'news'; since: number }

export function tourStart(onboarding: Onboarding, version: number = TOUR_VERSION): TourStart {
  const done = onboarding.tour_version_done
  if (done >= version) return { kind: 'none' }
  if (done > 0) return { kind: 'news', since: done }
  return onboarding.tour_invite ? { kind: 'invite' } : { kind: 'auto' }
}

/** The steps to show: all of them, or only the ones newer than `since`; server steps dropped
 * when the person isn't in any server. */
export function tourSteps<T extends TourStepBase>(steps: T[], options: { since?: number; hasServer: boolean }): T[] {
  return steps.filter((s) => (options.since === undefined || s.since > options.since) && (options.hasServer || !s.needsServer))
}

/** Tour finished, skipped or declined: saved as seen, so it doesn't come back. */
export function tourDone(onboarding: Onboarding, version: number = TOUR_VERSION): Onboarding {
  return { ...onboarding, tour_version_done: Math.max(version, onboarding.tour_version_done), tour_invite: false }
}

export function withTipSeen(onboarding: Onboarding, tip: string): Onboarding {
  if (onboarding.tips_seen.includes(tip)) return onboarding
  return { ...onboarding, tips_seen: [...onboarding.tips_seen, tip] }
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export type Side = 'bottom' | 'top' | 'right' | 'left' | 'center'

/**
 * Where a balloon of `size` goes next to `target`, inside a `view` of that size: below if it
 * fits, else above, then to the right, then to the left; always kept `margin` px inside the
 * window. No target: centered.
 */
export function balloonPosition(
  target: Box | null,
  size: { width: number; height: number },
  view: { width: number; height: number },
  gap = 14,
  margin = 12
): { left: number; top: number; side: Side } {
  const clamp = (value: number, max: number): number => Math.max(margin, Math.min(value, max - margin))
  if (!target) {
    return { left: Math.max(margin, (view.width - size.width) / 2), top: Math.max(margin, (view.height - size.height) / 2), side: 'center' }
  }
  const centerX = target.left + target.width / 2 - size.width / 2
  const centerY = target.top + target.height / 2 - size.height / 2
  const below = target.top + target.height + gap
  const above = target.top - gap - size.height
  const right = target.left + target.width + gap
  const left = target.left - gap - size.width
  if (below + size.height <= view.height - margin) {
    return { left: clamp(centerX, view.width - size.width), top: below, side: 'bottom' }
  }
  if (above >= margin) return { left: clamp(centerX, view.width - size.width), top: above, side: 'top' }
  if (right + size.width <= view.width - margin) return { left: right, top: clamp(centerY, view.height - size.height), side: 'right' }
  if (left >= margin) return { left, top: clamp(centerY, view.height - size.height), side: 'left' }
  // Bigger than any free side (a target filling the window): over it, centered.
  return { left: clamp(centerX, view.width - size.width), top: clamp(centerY, view.height - size.height), side: 'center' }
}
