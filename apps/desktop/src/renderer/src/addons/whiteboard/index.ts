import { Presentation } from 'lucide-react'

import type { AddonModule } from '../types'
import { dispatchLive, useWhiteboard } from './store'
import { WhiteboardSummary } from './Summary'
import { WhiteboardPanel } from './WhiteboardPanel'
import { t } from '../../lib/i18n'

/** Whiteboard: several boards per channel, drawn together with Excalidraw (loaded when a board
 * opens). Talks only to its own API routes and keeps its own state. */
const whiteboard: AddonModule = {
  key: 'whiteboard',
  get name() {
    return t('addons.whiteboard.name')
  },
  get description() {
    return t('addons.whiteboard.description')
  },
  icon: Presentation,
  permissions: ['EDIT_WHITEBOARD'],
  Panel: WhiteboardPanel,
  Summary: WhiteboardSummary,
  get announces() {
    return {
      label: t('addons.whiteboard.announces.label'),
      hint: t('addons.whiteboard.announces.hint'),
      warning: t('addons.whiteboard.announces.warning')
    }
  },
  onEvent: (event) => {
    const store = useWhiteboard.getState()
    if (event.type.startsWith('addon.whiteboard.board.')) store.apply(event.type, event.data)
    else dispatchLive(event)
    // Reconnected: lists already loaded may have changed meanwhile.
    if (event.type === 'ready') Object.keys(store.lists).forEach((id) => void store.load(id).catch(() => {}))
  }
}

export default whiteboard
