import { SquareKanban } from 'lucide-react'

import type { AddonModule } from '../types'
import { KanbanPanel } from './KanbanPanel'
import { useKanban } from './store'
import { KanbanSummary } from './Summary'
import { t } from '../../lib/i18n'

/** Kanban board: columns, cards, drag between columns, live updates and history. Built to stand
 * alone one day: it only talks to its own API routes and keeps its own state. */
const kanban: AddonModule = {
  key: 'kanban',
  get name() {
    return t('addons.kanban.name')
  },
  get description() {
    return t('addons.kanban.description')
  },
  icon: SquareKanban,
  // Cards; columns and labels need MANAGE_ADDONS.
  permissions: ['SEND_MESSAGES'],
  Panel: KanbanPanel,
  Summary: KanbanSummary,
  get announces() {
    return {
      label: t('addons.kanban.announces.label'),
      hint: t('addons.kanban.announces.hint'),
      warning: t('addons.kanban.announces.warning')
    }
  },
  onEvent: ({ type, data }) => {
    const kanban = useKanban.getState()
    if (type.startsWith('addon.kanban.')) kanban.apply(type, data)
    // Reconnected: boards already open may have changed meanwhile.
    if (type === 'ready') Object.keys(kanban.boards).forEach((id) => void kanban.load(id).catch(() => {}))
  }
}

export default kanban
