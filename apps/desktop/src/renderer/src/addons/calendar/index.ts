import { Calendar } from 'lucide-react'

import type { AddonModule } from '../types'
import { CalendarPanel } from './CalendarPanel'
import { useCalendar } from './store'
import { CalendarSummary } from './Summary'
import { t } from '../../lib/i18n'

/** Calendar: month, week and list views of the server's dates (events, Kanban due dates), from
 * the other addons. Keeps nothing of its own; it refreshes when they change. */
const calendar: AddonModule = {
  key: 'calendar',
  get name() {
    return t('addons.calendar.name')
  },
  get description() {
    return t('addons.calendar.description')
  },
  icon: Calendar,
  permissions: [],
  Panel: CalendarPanel,
  Summary: CalendarSummary,
  onEvent: ({ type }) => useCalendar.getState().onEvent(type),
  onOtherEvent: ({ type }) => useCalendar.getState().onEvent(type)
}

export default calendar
