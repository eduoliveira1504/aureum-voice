import { CalendarDays } from 'lucide-react'

import type { AddonModule } from '../types'
import { EventsPanel } from './EventsPanel'
import { useEvents } from './store'
import { EventsSummary } from './Summary'

/** Events: meetups with a time, a place and who's going; @aureum reminds who said Vou or Talvez.
 * Talks only to its own API routes and keeps its own state. */
const events: AddonModule = {
  key: 'events',
  name: 'Eventos',
  description: 'Encontros marcados, com quem vai e lembretes antes de começar.',
  icon: CalendarDays,
  // Creating and editing events; whoever can manage addons can too. Everyone who sees it answers.
  permissions: ['MANAGE_EVENTS'],
  Panel: EventsPanel,
  Summary: EventsSummary,
  announces: {
    label: 'Avisar novos eventos em',
    hint: 'Quando alguém cria um evento, aparece uma linha nesse canal de texto.',
    warning: 'Pessoas sem acesso a este canal vão ver os nomes dos eventos nesse canal.'
  },
  onEvent: ({ type, data }) => {
    const store = useEvents.getState()
    if (type.startsWith('addon.events.')) store.apply(type, data)
    // Reconnected: lists already loaded may have changed meanwhile.
    if (type === 'ready') Object.keys(store.lists).forEach((id) => void store.load(id).catch(() => {}))
  }
}

export default events
