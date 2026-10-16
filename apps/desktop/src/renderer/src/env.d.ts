/// <reference types="vite/client" />

import type { AureumBridge } from '../../shared/types'

declare global {
  interface Window {
    aureum: AureumBridge
  }
}
