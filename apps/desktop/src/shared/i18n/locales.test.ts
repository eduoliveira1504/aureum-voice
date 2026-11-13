import { describe, expect, it } from 'vitest'

import { isLanguagePreference, resolveLocale, systemLocale } from './locales'

describe('systemLocale', () => {
  it('maps any Portuguese and English variant', () => {
    expect(systemLocale(['pt-BR'])).toBe('pt-BR')
    expect(systemLocale(['pt-PT'])).toBe('pt-BR')
    expect(systemLocale(['en-US'])).toBe('en')
    expect(systemLocale(['en_GB'])).toBe('en')
  })

  it('takes the first language with a translation', () => {
    expect(systemLocale(['fr-FR', 'en-US', 'pt-BR'])).toBe('en')
  })

  it('falls back to Portuguese', () => {
    expect(systemLocale(['fr-FR', 'de'])).toBe('pt-BR')
    expect(systemLocale([])).toBe('pt-BR')
  })
})

describe('resolveLocale', () => {
  it('follows the system only when asked to', () => {
    expect(resolveLocale('system', 'en')).toBe('en')
    expect(resolveLocale('pt-BR', 'en')).toBe('pt-BR')
    expect(resolveLocale('en', 'pt-BR')).toBe('en')
  })

  it('accepts only known preferences', () => {
    expect(isLanguagePreference('system')).toBe(true)
    expect(isLanguagePreference('en')).toBe(true)
    expect(isLanguagePreference('fr')).toBe(false)
    expect(isLanguagePreference(undefined)).toBe(false)
  })
})
