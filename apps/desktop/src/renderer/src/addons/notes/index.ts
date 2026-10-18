import { NotebookPen } from 'lucide-react'

import type { AddonModule } from '../types'
import { NotesPanel, NotesSettings, NotesSummary } from './NotesPanel'
import { useNotes, type NotesPage } from './store'

/** Example addon: one shared text page per channel. Small on purpose; it exercises every part
 * of the addon framework. */
const notes: AddonModule = {
  key: 'notes',
  name: 'Bloco de notas',
  description: 'Uma página de texto compartilhada pelo canal.',
  icon: NotebookPen,
  Panel: NotesPanel,
  Summary: NotesSummary,
  Settings: NotesSettings,
  onEvent: ({ type, data }) => {
    const notes = useNotes.getState()
    if (type === 'addon.notes.updated') notes.apply(data.channel_id, data as NotesPage)
    // Reconnected: pages already open may have changed meanwhile.
    if (type === 'ready') Object.keys(notes.pages).forEach((id) => void notes.load(id).catch(() => {}))
  }
}

export default notes
