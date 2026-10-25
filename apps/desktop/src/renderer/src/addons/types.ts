import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'

import type { Channel, Me, ServerDetail } from '../lib/api'
import type { PermName } from '../lib/permissions'
import type { ServerEvent } from '../lib/realtime'

/** What the shell hands an addon's views: the channel it runs in and who's looking. */
export interface AddonViewProps {
  server: ServerDetail
  channel: Channel
  me: Me
  /** The user's permissions in the channel (bits from lib/permissions). */
  perms: number
  /** An item picked outside the addon (a task in Home): show it, then call onItemOpened. */
  openItem?: string | null
  onItemOpened?: () => void
}

export interface AddonSettingsProps {
  config: Record<string, unknown>
  onChange(config: Record<string, unknown>): void
}

/**
 * The desktop half of an addon (the API half lives in apps/api/app/addons/<key>). Each addon
 * is a folder in src/addons/<key>/ whose index exports one of these; it talks to its own API
 * routes and keeps its own state, and never reaches into the shell's stores.
 */
export interface AddonModule {
  /** Same key as the API's manifest. */
  key: string
  name: string
  description: string
  icon: LucideIcon
  /** The channel's content, inside a panel. */
  Panel: ComponentType<AddonViewProps>
  /** Short live summary for the channel's card on the server overview. */
  Summary?: ComponentType<AddonViewProps>
  /** The permissions its actions need, besides MANAGE_ADDONS (same as the API manifest): what
   * the channel's overrides offer, under "Addons". */
  permissions: PermName[]
  /** Form for channels.config, shown in the channel settings to who can manage addons. */
  Settings?: ComponentType<AddonSettingsProps>
  /** Set when the addon posts system lines to a chat (its API manifest says `announces`): the
   * channel settings then offer a text channel to post them in, with these texts. */
  announces?: {
    /** Label of the channel picker ("Avisar movimentações em"). */
    label: string
    hint: string
    /** Shown before picking a channel that people who can't see the addon channel can see. */
    warning: string
  }
  /** Its `addon.<key>.*` events from the WebSocket, plus 'ready' after every (re)connection. */
  onEvent?(event: ServerEvent): void
}
