/**
 * Checks a macOS privacy permission before the app uses the microphone, the camera or the screen
 * (block 3.21). When it's off, the notice (AccessNotice) explains where to turn it on. Elsewhere it
 * always goes ahead.
 */
import { create } from 'zustand'

import { mayProceed, type MediaAccess, type MediaKind } from '../../../shared/mediaAccess'
import { isMac } from './platform'

/** The permission whose notice is open, if any. */
export const useAccessNotice = create<{ kind: MediaKind | null }>(() => ({ kind: null }))

/** True when the app may use it; false (and the notice opens) when macOS says no. */
export async function ensureAccess(kind: MediaKind): Promise<boolean> {
  if (!isMac()) return true
  const access: MediaAccess = await window.aureum.media.access(kind).catch(() => 'unknown' as const)
  if (mayProceed(kind, access)) return true
  useAccessNotice.setState({ kind })
  return false
}
