/**
 * Every text of the app, one JSON file per area and language (block 4.2.6). pt-BR is the source:
 * the English files must have the same keys (the compiler checks the missing ones, resources.test
 * the extra ones and the {{placeholders}}). All areas go in one namespace, so a key reads
 * `area.thing` (t('chat.composer.placeholder')).
 */

import enAccount from './locales/en/account.json'
import enAuth from './locales/en/auth.json'
import enCommon from './locales/en/common.json'
import enErrors from './locales/en/errors.json'
import enProfile from './locales/en/profile.json'
import enSettings from './locales/en/settings.json'
import enSystem from './locales/en/system.json'
import ptAccount from './locales/pt-BR/account.json'
import ptAuth from './locales/pt-BR/auth.json'
import ptCommon from './locales/pt-BR/common.json'
import ptErrors from './locales/pt-BR/errors.json'
import ptProfile from './locales/pt-BR/profile.json'
import ptSettings from './locales/pt-BR/settings.json'
import ptSystem from './locales/pt-BR/system.json'

export const ptBR = {
  common: ptCommon,
  settings: ptSettings,
  system: ptSystem,
  errors: ptErrors,
  auth: ptAuth,
  account: ptAccount,
  profile: ptProfile
}

export const en: typeof ptBR = {
  common: enCommon,
  settings: enSettings,
  system: enSystem,
  errors: enErrors,
  auth: enAuth,
  account: enAccount,
  profile: enProfile
}

export const resources = {
  'pt-BR': { translation: ptBR },
  en: { translation: en }
} as const
