import { Puzzle, type LucideIcon } from 'lucide-react'

import type { ServerEvent } from '../lib/realtime'
import kanban from './kanban'
import type { AddonModule } from './types'

/**
 * The addons this app version ships. A channel whose addon isn't here (an older app talking to
 * a newer API) still shows up, with a note to update the app. Adding one: create
 * src/addons/<key>/ and list it here.
 */
const MODULES: Record<string, AddonModule> = Object.fromEntries([kanban].map((m) => [m.key, m]))

export function addonModule(key: string | null | undefined): AddonModule | undefined {
  return key ? MODULES[key] : undefined
}

export function addonIcon(key: string | null | undefined): LucideIcon {
  return addonModule(key)?.icon ?? Puzzle
}

/** Forwards `addon.<key>.<event>` WebSocket events to their addon, and 'ready' (connected or
 * reconnected: refetch what may have been missed) to all of them. */
export function dispatchAddonEvent(event: ServerEvent): void {
  if (event.type === 'ready') Object.values(MODULES).forEach((m) => m.onEvent?.(event))
  else if (event.type.startsWith('addon.')) addonModule(event.type.split('.')[1])?.onEvent?.(event)
}
