import { Puzzle, type LucideIcon } from 'lucide-react'

import type { ServerEvent } from '../lib/realtime'
import kanban from './kanban'
import polls from './polls'
import type { AddonModule, ChatAddonModule } from './types'
import whiteboard from './whiteboard'

/**
 * The addons this app version ships. A channel whose addon isn't here (an older app talking to
 * a newer API) still shows up, with a note to update the app. Adding one: create
 * src/addons/<key>/ and list it here.
 */
const MODULES: Record<string, AddonModule> = Object.fromEntries([kanban, whiteboard].map((m) => [m.key, m]))

/** Addons that live in chats (their things are messages), by key. */
const CHAT_MODULES: Record<string, ChatAddonModule> = Object.fromEntries([polls].map((m) => [m.key, m]))

export function chatAddon(key: string | null | undefined): ChatAddonModule | undefined {
  return key ? CHAT_MODULES[key] : undefined
}

/** The chat addons that add something to the message box's "+" menu. */
export const chatComposerAddons = (): (ChatAddonModule & Required<Pick<ChatAddonModule, 'composer'>>)[] =>
  Object.values(CHAT_MODULES).filter((m): m is ChatAddonModule & Required<Pick<ChatAddonModule, 'composer'>> => !!m.composer)

export function addonModule(key: string | null | undefined): AddonModule | undefined {
  return key ? MODULES[key] : undefined
}

export function addonIcon(key: string | null | undefined): LucideIcon {
  return addonModule(key)?.icon ?? Puzzle
}

/** Forwards `addon.<key>.<event>` WebSocket events to their addon, and 'ready' (connected or
 * reconnected: refetch what may have been missed) to all of them. */
export function dispatchAddonEvent(event: ServerEvent): void {
  if (event.type === 'ready') [...Object.values(MODULES), ...Object.values(CHAT_MODULES)].forEach((m) => m.onEvent?.(event))
  else if (event.type.startsWith('addon.')) {
    const key = event.type.split('.')[1]
    ;(addonModule(key) ?? chatAddon(key))?.onEvent?.(event)
  }
}
