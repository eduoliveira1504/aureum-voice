import { CalendarDays } from 'lucide-react'

import type { AddonModule } from '../types'
import { EventsPanel } from './EventsPanel'
import { useEvents } from './store'
import { EventsSummary } from './Summary'
import { t } from '../../lib/i18n'

/** Events: meetups with a time, a place and who's going; @aureum reminds who said Vou or Talvez.
 * Talks only to its own API routes and keeps its own state. */
const events: AddonModule = {
  key: 'events',
  get name() {
    return t('addons.events.name')
  },
  get description() {
    return t('addons.events.description')
  },
  icon: CalendarDays,
  // Creating and editing events; whoever can manage addons can too. Everyone who sees it answers.
  permissions: ['MANAGE_EVENTS'],
  Panel: EventsPanel,
  Summary: EventsSummary,
  get announces() {
    return {
      label: t('addons.events.announces.label'),
      hint: t('addons.events.announces.hint'),
      warning: t('addons.events.announces.warning')
    }
  },
  onEvent: ({ type, data }) => {
    const store = useEvents.getState()
    if (type.startsWith('addon.events.')) store.apply(type, data)
    // Reconnected: lists already loaded may have changed meanwhile.
    if (type === 'ready') Object.keys(store.lists).forEach((id) => void store.load(id).catch(() => {}))
  }
}

export default events
