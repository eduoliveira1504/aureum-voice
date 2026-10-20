import type { ReactNode } from 'react'

import type { OfficialCategory } from '../lib/api'
import { useAppearance } from '../store/appearance'
import { labelClass, ToggleRow } from './ui'

const CATEGORIES: { key: OfficialCategory; title: string; description: string }[] = [
  {
    key: 'seguranca',
    title: 'Segurança',
    description: 'Senha ou e-mail alterados e login num computador novo. Sempre ligado, e avisa mesmo com a conversa silenciada.'
  },
  { key: 'insignias', title: 'Insígnias', description: 'Quando você ganha uma insígnia.' },
  { key: 'bugs', title: 'Bugs', description: 'Quando um problema que você reportou é resolvido.' },
  { key: 'convites', title: 'Convites', description: 'Quando alguém entra com um convite seu.' },
  { key: 'novidades', title: 'Novidades', description: 'O que mudou em cada versão nova do app.' },
  { key: 'avisos', title: 'Avisos', description: 'Avisos gerais da equipe do Aureum.' }
]

/** Settings > Notificações: what the official Aureum conversation sends. Synced to the account. */
export function NotificationSettings(): ReactNode {
  const prefs = useAppearance((s) => s.settings.official_dm ?? {})
  const updateEntry = useAppearance((s) => s.updateEntry)

  return (
    <div className="max-w-[480px] space-y-3">
      <div>
        <span className={labelClass}>Conversa oficial do Aureum</span>
        <p className="text-sm text-fg-muted">
          A @aureum manda avisos numa conversa só de leitura, fixada no topo das suas mensagens. Escolha o que quer receber.
        </p>
      </div>
      {CATEGORIES.map(({ key, title, description }) =>
        key === 'seguranca' ? (
          <ToggleRow key={key} title={title} description={description} checked onChange={() => {}} disabled />
        ) : (
          <ToggleRow
            key={key}
            title={title}
            description={description}
            checked={prefs[key] !== false}
            // Off is stored as false; on removes the entry (missing means on).
            onChange={(on) => updateEntry('official_dm', key, on ? null : false)}
          />
        )
      )}
      <p className="text-xs text-fg-subtle">Pra só tirar o som, silencie a conversa: as mensagens continuam chegando.</p>
    </div>
  )
}
