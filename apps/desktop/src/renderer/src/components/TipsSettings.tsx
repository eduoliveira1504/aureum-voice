import { useState, type ReactNode } from 'react'

import { useAppearance } from '../store/appearance'
import { useOnboarding } from '../store/onboarding'
import { labelClass } from './ui'

const rowButton = 'shrink-0 rounded-control bg-elevated px-3 py-1.5 text-sm font-medium text-fg hover:bg-line disabled:opacity-60'

/** Configurações › Dicas (block 3.16): the tour again, and the first-time tips back. Synced to the account. */
export function TipsSettings({ onClose }: { onClose(): void }): ReactNode {
  const seen = useAppearance((s) => s.settings.onboarding.tips_seen.length)
  const [reset, setReset] = useState(false)

  return (
    <div className="max-w-[480px] space-y-3">
      <span className={labelClass}>Tour e dicas</span>
      <div className="flex items-center justify-between gap-4 rounded-control border border-line bg-main px-3 py-2.5">
        <span>
          <span className="block font-medium">Tour pelo Aureum</span>
          <span className="block text-xs text-fg-subtle">Uma volta rápida pelas abas, o Início, os painéis e o seu perfil.</span>
        </span>
        <button
          type="button"
          className={rowButton}
          onClick={() => {
            onClose()
            useOnboarding.getState().startTour()
          }}
        >
          Rever tour
        </button>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-control border border-line bg-main px-3 py-2.5">
        <span>
          <span className="block font-medium">Dicas de primeira vez</span>
          <span className="block text-xs text-fg-subtle">
            {reset ? 'Pronto: as dicas voltam a aparecer quando você usar cada coisa.' : 'Os balões que aparecem quando você usa algo pela primeira vez.'}
          </span>
        </span>
        <button
          type="button"
          className={rowButton}
          disabled={seen === 0}
          onClick={() => {
            useOnboarding.getState().resetTips()
            setReset(true)
          }}
        >
          Mostrar dicas de novo
        </button>
      </div>
    </div>
  )
}
