import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { OfficialCategory } from '../lib/api'
import { useAppearance } from '../store/appearance'
import { labelClass, ToggleRow } from './ui'

const CATEGORIES: { key: OfficialCategory }[] = [
  { key: 'seguranca' },
  { key: 'insignias' },
  { key: 'eventos' },
  { key: 'bugs' },
  { key: 'convites' },
  { key: 'novidades' },
  { key: 'avisos' }
]

/** Settings > Notificações: what the official Aureum conversation sends. Synced to the account. */
export function NotificationSettings(): ReactNode {
  const { t } = useTranslation()
  const prefs = useAppearance((s) => s.settings.official_dm ?? {})
  const updateEntry = useAppearance((s) => s.updateEntry)

  return (
    <div className="max-w-[480px] space-y-3">
      <div>
        <span className={labelClass}>{t('settings.notifications.official')}</span>
        <p className="text-sm text-fg-muted">
          {t('settings.notifications.officialHint')}
        </p>
      </div>
      {CATEGORIES.map(({ key }) => {
        const title = t(`settings.notifications.categories.${key}.title`)
        const description = t(`settings.notifications.categories.${key}.description`)
        return key === 'seguranca' ? (
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
      })}
      <p className="text-xs text-fg-subtle">{t('settings.notifications.muteHint')}</p>
    </div>
  )
}
