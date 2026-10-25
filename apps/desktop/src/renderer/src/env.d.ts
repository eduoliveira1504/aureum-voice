/// <reference types="vite/client" />

import type { AureumBridge } from '../../shared/types'

declare global {
  interface Window {
    aureum: AureumBridge
    /** Where Excalidraw (the whiteboard) loads its fonts from. */
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}
