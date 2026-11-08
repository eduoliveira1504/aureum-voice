/// <reference types="vite/client" />

import type { AureumBridge, SplashBridge } from '../../shared/types'

declare global {
  interface Window {
    aureum: AureumBridge
    /** Only in the loading screen (splash.html). */
    aureumSplash?: SplashBridge
    /** Where Excalidraw (the whiteboard) loads its fonts from. */
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}
