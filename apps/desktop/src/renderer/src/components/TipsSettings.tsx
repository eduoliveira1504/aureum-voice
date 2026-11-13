import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppearance } from '../store/appearance'
import { useOnboarding } from '../store/onboarding'
import { labelClass } from './ui'

const rowButton = 'shrink-0 rounded-control bg-elevated px-3 py-1.5 text-sm font-medium text-fg hover:bg-line disabled:opacity-60'

/** Configurações › Dicas (block 3.16): the tour again, and the first-time tips back. Synced to the account. */
export function TipsSettings({ onClose }: { onClose(): void }): ReactNode {
  const { t } = useTranslation()
  const seen = useAppearance((s) => s.settings.onboarding.tips_seen.length)
  const [reset, setReset] = useState(false)

  return (
    <div className="max-w-[480px] space-y-3">
      <span className={labelClass}>{t('settings.tips.title')}</span>
      <div className="flex items-center justify-between gap-4 rounded-control border border-line bg-main px-3 py-2.5">
        <span>
          <span className="block font-medium">{t('settings.tips.tour')}</span>
          <span className="block text-xs text-fg-subtle">{t('settings.tips.tourHint')}</span>
        </span>
        <button
          type="button"
          className={rowButton}
          onClick={() => {
            onClose()
            useOnboarding.getState().startTour()
          }}
        >
          {t('settings.tips.replay')}
        </button>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-control border border-line bg-main px-3 py-2.5">
        <span>
          <span className="block font-medium">{t('settings.tips.firstTime')}</span>
          <span className="block text-xs text-fg-subtle">
            {reset ? t('settings.tips.resetDone') : t('settings.tips.firstTimeHint')}
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
          {t('settings.tips.showAgain')}
        </button>
      </div>
    </div>
  )
}
