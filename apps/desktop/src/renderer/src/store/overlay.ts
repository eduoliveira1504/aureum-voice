import { create } from 'zustand'

import type { OverlayPrefs, OverlayState } from '../../../shared/types'

/** In-game overlay preferences and edit mode, as the main process has them. */
export const useOverlay = create<{ state: OverlayState | null }>()(() => ({ state: null }))

void window.aureum.overlay.getState().then((state) => useOverlay.setState({ state }))
window.aureum.overlay.onState((state) => useOverlay.setState({ state }))

/** Saves preferences; resolves to an error message when the main process refuses them. */
export async function setOverlayPrefs(patch: Partial<OverlayPrefs>): Promise<string | null> {
  try {
    useOverlay.setState({ state: await window.aureum.overlay.setPrefs(patch) })
    return null
  } catch (err) {
    // Electron prefixes errors thrown in the main process ("Error invoking remote method ...").
    return String((err as Error).message).replace(/^.*?Error: /, '')
  }
}
