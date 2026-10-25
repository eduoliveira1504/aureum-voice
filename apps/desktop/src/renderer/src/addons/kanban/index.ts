import { SquareKanban } from 'lucide-react'

import type { AddonModule } from '../types'
import { KanbanPanel } from './KanbanPanel'
import { useKanban } from './store'
import { KanbanSummary } from './Summary'

/** Kanban board: columns, cards, drag between columns, live updates and history. Built to stand
 * alone one day: it only talks to its own API routes and keeps its own state. */
const kanban: AddonModule = {
  key: 'kanban',
  name: 'Kanban',
  description: 'Colunas e cards para organizar o que o grupo está fazendo.',
  icon: SquareKanban,
  // Cards; columns and labels need MANAGE_ADDONS.
  permissions: ['SEND_MESSAGES'],
  Panel: KanbanPanel,
  Summary: KanbanSummary,
  announces: {
    label: 'Avisar movimentações em',
    hint: 'Quando alguém move um card para outra coluna, aparece uma linha nesse canal de texto.',
    warning: 'Pessoas sem acesso ao quadro vão ver os títulos dos cards nesse canal.'
  },
  onEvent: ({ type, data }) => {
    const kanban = useKanban.getState()
    if (type.startsWith('addon.kanban.')) kanban.apply(type, data)
    // Reconnected: boards already open may have changed meanwhile.
    if (type === 'ready') Object.keys(kanban.boards).forEach((id) => void kanban.load(id).catch(() => {}))
  }
}

export default kanban
