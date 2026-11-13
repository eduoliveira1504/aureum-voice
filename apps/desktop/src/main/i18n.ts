/**
 * Texts of the main process (tray, Mac menu, notices, the loading screen's status) in the app's
 * language (block 4.2.6). Same files as the window; settings:set changes the language here too.
 */
import { app } from 'electron'
import i18next from 'i18next'

import { DEFAULT_LOCALE, resolveLocale, systemLocale, type LanguagePreference, type Locale } from '../shared/i18n/locales'
import { resources } from '../shared/i18n/resources'

const i18n = i18next.createInstance()
void i18n.init({ resources, lng: DEFAULT_LOCALE, fallbackLng: DEFAULT_LOCALE, initAsync: false, interpolation: { escapeValue: false } })

export const t = i18n.t.bind(i18n) as typeof i18n.t

let system: Locale | null = null

/** The OS's language, read once (Electron gives the user's preferred list in order). */
export function systemLanguage(): Locale {
  system ??= systemLocale(app.getPreferredSystemLanguages())
  return system
}

/** Switches the main process's texts; true if the language changed. */
export function applyLanguage(preference: LanguagePreference): boolean {
  const locale = resolveLocale(preference, systemLanguage())
  if (locale === i18n.language) return false
  void i18n.changeLanguage(locale)
  return true
}
