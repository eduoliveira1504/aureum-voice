/**
 * Texts of the main process (tray, Mac menu, notices, the loading screen's status) in the app's
 * language (block 4.2.6). Same files as the window; settings:set changes the language here too.
 * No Electron import here, so the main process's tests can use t().
 */
import i18next from 'i18next'

import { DEFAULT_LOCALE, resolveLocale, type LanguagePreference, type Locale } from '../shared/i18n/locales'
import { resources } from '../shared/i18n/resources'

const i18n = i18next.createInstance()
void i18n.init({ resources, lng: DEFAULT_LOCALE, fallbackLng: DEFAULT_LOCALE, initAsync: false, interpolation: { escapeValue: false } })

export const t = i18n.t.bind(i18n) as typeof i18n.t

/** Switches the main process's texts; true if the language changed. */
export function applyLanguage(preference: LanguagePreference, system: Locale): boolean {
  const locale = resolveLocale(preference, system)
  if (locale === i18n.language) return false
  void i18n.changeLanguage(locale)
  return true
}
