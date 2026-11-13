/**
 * The app's languages (block 4.2.6). The choice lives on this computer (settings.json), not in
 * the account: the sign-in screen needs it before anyone signs in, and the system language is
 * per computer too. "system" follows the OS; a language without a translation falls back to pt-BR.
 */

export const LOCALES = ['pt-BR', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export type LanguagePreference = 'system' | Locale

export const DEFAULT_LOCALE: Locale = 'pt-BR'
export const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = ['system', ...LOCALES]

export const isLanguagePreference = (value: unknown): value is LanguagePreference =>
  LANGUAGE_PREFERENCES.includes(value as LanguagePreference)

/** The first of the OS's preferred languages ("pt-PT", "en-US", ...) the app has a translation for. */
export function systemLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split(/[-_]/)[0]
    if (base === 'pt') return 'pt-BR'
    if (base === 'en') return 'en'
  }
  return DEFAULT_LOCALE
}

export const resolveLocale = (preference: LanguagePreference, system: Locale): Locale =>
  preference === 'system' ? system : preference
