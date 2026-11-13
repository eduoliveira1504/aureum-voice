import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { LANGUAGE_PREFERENCES, type LanguagePreference } from '../../../shared/i18n/locales'
import { languagePreference, setLanguage } from '../lib/i18n'
import { labelClass } from './ui'

/** Configurações › Idioma (block 4.2.6): follow the system, Portuguese or English. Changing it
 * updates every screen right away; the choice stays on this computer. */
export function LanguageSettings(): ReactNode {
  const { t } = useTranslation()
  const [value, setValue] = useState<LanguagePreference>(languagePreference)
  const [error, setError] = useState(false)

  function choose(next: LanguagePreference): void {
    setValue(next)
    setError(false)
    setLanguage(next).catch(() => setError(true))
  }

  return (
    <div className="space-y-2">
      <span id="language-label" className={labelClass}>
        {t('settings.language.label')}
      </span>
      <div role="radiogroup" aria-labelledby="language-label" className="space-y-1">
        {LANGUAGE_PREFERENCES.map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-center gap-3 rounded-control border border-line bg-main px-3 py-2.5 text-sm hover:border-accent/60"
          >
            <input
              type="radio"
              name="language"
              className="accent-accent"
              checked={value === option}
              onChange={() => choose(option)}
            />
            {option === 'system'
              ? t('settings.language.systemNow', { language: t(`common.language.${window.aureum.i18n.system}`) })
              : t(`common.language.${option}`)}
          </label>
        ))}
      </div>
      <p className="text-xs text-fg-subtle">{t('settings.language.hint')}</p>
      {error && <p className="text-sm text-danger">{t('common.saveFailed')}</p>}
    </div>
  )
}
