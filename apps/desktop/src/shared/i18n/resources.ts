/**
 * Every text of the app, one JSON file per area and language (block 4.2.6). pt-BR is the source:
 * the English files must have the same keys (the compiler checks the missing ones, resources.test
 * the extra ones and the {{placeholders}}). All areas go in one namespace, so a key reads
 * `area.thing` (t('chat.composer.placeholder')).
 */

import enCommon from './locales/en/common.json'
import enSettings from './locales/en/settings.json'
import ptCommon from './locales/pt-BR/common.json'
import ptSettings from './locales/pt-BR/settings.json'

export const ptBR = {
  common: ptCommon,
  settings: ptSettings
}

export const en: typeof ptBR = {
  common: enCommon,
  settings: enSettings
}

export const resources = {
  'pt-BR': { translation: ptBR },
  en: { translation: en }
} as const
