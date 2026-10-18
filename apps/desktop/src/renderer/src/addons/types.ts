import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'

import type { Channel, Me, ServerDetail } from '../lib/api'
import type { ServerEvent } from '../lib/realtime'

/** What the shell hands an addon's views: the channel it runs in and who's looking. */
export interface AddonViewProps {
  server: ServerDetail
  channel: Channel
  me: Me
  /** The user's permissions in the channel (bits from lib/permissions). */
  perms: number
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
  /** Form for channels.config, shown in the channel settings to who can manage addons. */
  Settings?: ComponentType<AddonSettingsProps>
  /** Its `addon.<key>.*` events from the WebSocket, plus 'ready' after every (re)connection. */
  onEvent?(event: ServerEvent): void
}
