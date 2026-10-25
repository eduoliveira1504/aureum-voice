import { Presentation } from 'lucide-react'

import type { AddonModule } from '../types'
import { dispatchLive, useWhiteboard } from './store'
import { WhiteboardSummary } from './Summary'
import { WhiteboardPanel } from './WhiteboardPanel'

/** Whiteboard: several boards per channel, drawn together with Excalidraw (loaded when a board
 * opens). Talks only to its own API routes and keeps its own state. */
const whiteboard: AddonModule = {
  key: 'whiteboard',
  name: 'Quadro branco',
  description: 'Desenho livre, formas, notas e imagens, juntos e ao vivo.',
  icon: Presentation,
  permissions: ['EDIT_WHITEBOARD'],
  Panel: WhiteboardPanel,
  Summary: WhiteboardSummary,
  announces: {
    label: 'Avisar novos quadros em',
    hint: 'Quando alguém cria um quadro, aparece uma linha nesse canal de texto.',
    warning: 'Pessoas sem acesso a este canal vão ver os nomes dos quadros nesse canal.'
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
