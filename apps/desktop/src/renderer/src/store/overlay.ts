import { create } from 'zustand'

import type { OverlayPrefsPatch, OverlayState } from '../../../shared/types'
import { useAppearance } from './appearance'

/** How long a notification stays on the overlay. */
export const NOTIFICATION_MS = 5000
const MAX_NOTIFICATIONS = 4

export interface OverlayNotification {
  id: number
  kind: 'dm' | 'mention' | 'call' | 'joined' | 'left'
  name: string
  username?: string
  avatarUrl?: string | null
  /** The message, for 'dm' and 'mention'. */
  text?: string
}

interface OverlayStore {
  state: OverlayState | null
  notifications: OverlayNotification[]
}

/** In-game overlay preferences and edit mode, as the main process has them, and its notifications. */
export const useOverlay = create<OverlayStore>()(() => ({ state: null, notifications: [] }))

void window.aureum.overlay.getState().then((state) => useOverlay.setState({ state }))
window.aureum.overlay.onState((state) => useOverlay.setState({ state }))

/** Saves preferences; resolves to an error message when the main process refuses them. */
export async function setOverlayPrefs(patch: OverlayPrefsPatch): Promise<string | null> {
  try {
    useOverlay.setState({ state: await window.aureum.overlay.setPrefs(patch) })
    return null
  } catch (err) {
    // Electron prefixes errors thrown in the main process ("Error invoking remote method ...").
    return String((err as Error).message).replace(/^.*?Error: /, '')
  }
}

let nextId = 1

/**
 * Puts a notification on the overlay for a few seconds. Nothing while the app itself is in front
 * (it has its own), with the widget off, or in "Não perturbe". The main process still shows it only
 * over a game.
 */
export function notifyOverlay(notification: Omit<OverlayNotification, 'id'>): void {
  const prefs = useOverlay.getState().state?.prefs
  if (!prefs?.enabled || !prefs.widgets.notifications.enabled) return
  if (document.hasFocus() || useAppearance.getState().settings.status === 'dnd') return
  const id = nextId++
  useOverlay.setState((s) => ({ notifications: [...s.notifications, { ...notification, id }].slice(-MAX_NOTIFICATIONS) }))
  setTimeout(() => useOverlay.setState((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })), NOTIFICATION_MS)
}

/** Who joined and left between two looks at a room, leaving out `me`. */
export function callChanges(before: Set<string>, after: Set<string>, me: string): { joined: string[]; left: string[] } {
  return {
    joined: [...after].filter((id) => id !== me && !before.has(id)),
    left: [...before].filter((id) => id !== me && !after.has(id))
  }
}
