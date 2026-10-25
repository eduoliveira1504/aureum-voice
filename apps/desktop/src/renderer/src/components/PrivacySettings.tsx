import type { ReactNode } from 'react'

import { useAppearance } from '../store/appearance'
import { labelClass, ToggleRow } from './ui'

/** Settings > Privacidade. Synced to the account. */
export function PrivacySettings(): ReactNode {
  const receipts = useAppearance((s) => s.settings.read_receipts !== false)
  const update = useAppearance((s) => s.update)

  return (
    <div className="max-w-[480px] space-y-3">
      <span className={labelClass}>Mensagens privadas</span>
      <ToggleRow
        title="Confirmação de leitura"
        description="Nas conversas a dois, mostra quando a outra pessoa viu suas mensagens. Desligada, ela não vê quando você leu, e você também não vê quando ela leu."
        checked={receipts}
        onChange={(on) => update({ read_receipts: on })}
      />
    </div>
  )
}
