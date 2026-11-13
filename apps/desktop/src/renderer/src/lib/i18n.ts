/**
 * The window's texts (block 4.2.6). The language comes from the preload before the first render
 * (so nothing flashes in Portuguese), and changing it in Configurações › Idioma updates every
 * screen right away, without restarting.
 */
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import { DEFAULT_LOCALE, resolveLocale, type LanguagePreference, type Locale } from '../../../shared/i18n/locales'
import { resources } from '../../../shared/i18n/resources'

export const i18n = i18next.createInstance()

void i18n.use(initReactI18next).init({
  resources,
  lng: resolveLocale(window.aureum.i18n.preference, window.aureum.i18n.system),
  fallbackLng: DEFAULT_LOCALE,
  initAsync: false,
  interpolation: { escapeValue: false }
})

document.documentElement.lang = i18n.language
i18n.on('languageChanged', (locale) => {
  document.documentElement.lang = locale
})

/** For code outside React (stores, helpers). Components use useTranslation(), which re-renders. */
export const t = i18n.t.bind(i18n) as typeof i18n.t

export const currentLocale = (): Locale => i18n.language as Locale

let preference = window.aureum.i18n.preference

export const languagePreference = (): LanguagePreference => preference

/** Saves the choice on this computer and switches every screen (and the tray) to it. */
export async function setLanguage(next: LanguagePreference): Promise<void> {
  preference = next
  await i18n.changeLanguage(resolveLocale(next, window.aureum.i18n.system))
  await window.aureum.settings.set({ language: next })
}
