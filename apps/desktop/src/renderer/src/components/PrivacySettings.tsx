import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppearance } from '../store/appearance'
import { labelClass, ToggleRow } from './ui'

/** Settings > Privacidade. Synced to the account. */
export function PrivacySettings(): ReactNode {
  const { t } = useTranslation()
  const receipts = useAppearance((s) => s.settings.read_receipts !== false)
  const update = useAppearance((s) => s.update)

  return (
    <div className="max-w-[480px] space-y-3">
      <span className={labelClass}>{t('settings.privacy.dms')}</span>
      <ToggleRow
        title={t('settings.privacy.receipts')}
        description={t('settings.privacy.receiptsHint')}
        checked={receipts}
        onChange={(on) => update({ read_receipts: on })}
      />
    </div>
  )
}
