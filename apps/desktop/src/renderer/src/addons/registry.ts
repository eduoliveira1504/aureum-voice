import { Clapperboard, SquareKanban, type LucideIcon } from 'lucide-react'

/**
 * Addons shown in the shell. Placeholders for now: block 2.8 brings addon channels
 * (channels.type = 'addon') and replaces this list with the server's addon registry.
 */
export interface AddonInfo {
  key: string
  name: string
  icon: LucideIcon
  /** What the addon will do, shown on its placeholder panel and overview card. */
  description: string
}

export const ADDONS: AddonInfo[] = [
  {
    key: 'board',
    name: 'Quadro',
    icon: SquareKanban,
    description: 'Colunas e cards do grupo, com responsável, etiquetas e prazo, atualizados em tempo real.'
  },
  {
    key: 'cinema',
    name: 'Cinema',
    icon: Clapperboard,
    description: 'Assistam YouTube juntos, com fila de vídeos e play/pause sincronizados.'
  }
]

export function addonInfo(key: string): AddonInfo | undefined {
  return ADDONS.find((a) => a.key === key)
}
