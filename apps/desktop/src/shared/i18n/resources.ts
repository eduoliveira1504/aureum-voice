/**
 * Every text of the app, one JSON file per area and language (block 4.2.6). pt-BR is the source:
 * the English files must have the same keys (the compiler checks the missing ones, resources.test
 * the extra ones and the {{placeholders}}). All areas go in one namespace, so a key reads
 * `area.thing` (t('chat.composer.placeholder')).
 */

import enCommon from './locales/en/common.json'
import ptCommon from './locales/pt-BR/common.json'

export const ptBR = {
  common: ptCommon
}

export const en: typeof ptBR = {
  common: enCommon
}

export const resources = {
  'pt-BR': { translation: ptBR },
  en: { translation: en }
} as const
