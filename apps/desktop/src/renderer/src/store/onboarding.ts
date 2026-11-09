import { create } from 'zustand'

import type { Onboarding } from '../lib/api'
import { tourDone, withTipSeen } from '../lib/onboarding'
import { useAppearance } from './appearance'

/**
 * The tour and the first-time tips on screen (block 3.16). What was seen is saved in
 * user_settings.onboarding (through the appearance store); this keeps what's showing now.
 */
interface OnboardingState {
  /** The server's onboarding arrived: until then nothing starts (the cached copy may be old). */
  ready: boolean
  /** The running tour; `since` shows only the steps newer than that version. */
  tour: { since?: number } | null
  /** "Quer fazer um tour rápido pelo Aureum?" on screen. */
  invite: boolean
  /** The one tip on screen and which mounted copy shows it (a tip can be mounted in many places). */
  tip: { key: string; token: number } | null
  setReady(): void
  startTour(since?: number): void
  /** Finished, skipped or Esc: saved as seen. */
  endTour(): void
  showInvite(): void
  /** "Agora não": never asked again ("Rever tour" stays in the profile menu). */
  declineInvite(): void
  acceptInvite(): void
  /** Takes the tip slot when it's free; false if another tip is showing. */
  claimTip(key: string, token: number): boolean
  releaseTip(token: number): void
  /** "Entendi": never shows again. */
  dismissTip(key: string): void
  /** Configurações › Dicas › "Mostrar dicas de novo". */
  resetTips(): void
}

const onboarding = (): Onboarding => useAppearance.getState().settings.onboarding
const save = (next: Onboarding): void => useAppearance.getState().update({ onboarding: next })

export const useOnboarding = create<OnboardingState>()((set, get) => ({
  ready: false,
  tour: null,
  invite: false,
  tip: null,

  setReady: () => set({ ready: true }),
  // A tip on screen gives way to the tour.
  startTour: (since) => set({ tour: since === undefined ? {} : { since }, invite: false, tip: null }),
  endTour: () => {
    set({ tour: null })
    save(tourDone(onboarding()))
  },
  showInvite: () => set({ invite: true, tip: null }),
  declineInvite: () => {
    set({ invite: false })
    save(tourDone(onboarding()))
  },
  acceptInvite: () => get().startTour(),

  claimTip: (key, token) => {
    const { ready, tour, invite, tip } = get()
    if (!ready || tour || invite || onboarding().tips_seen.includes(key)) return false
    if (tip) return tip.token === token
    set({ tip: { key, token } })
    return true
  },
  releaseTip: (token) => {
    if (get().tip?.token === token) set({ tip: null })
  },
  dismissTip: (key) => {
    if (get().tip?.key === key) set({ tip: null })
    save(withTipSeen(onboarding(), key))
  },
  resetTips: () => save({ ...onboarding(), tips_seen: [] })
}))
