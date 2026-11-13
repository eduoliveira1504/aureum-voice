import 'i18next'

import type { ptBR } from './resources'

// t() only accepts keys that exist in the pt-BR files.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof ptBR }
  }
}
