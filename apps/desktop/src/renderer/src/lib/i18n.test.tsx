import { act, render, screen } from '@testing-library/react'
import { useTranslation } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dateFormat, numberFormat } from './format'
import { i18n, languagePreference, setLanguage } from './i18n'

function Label() {
  const { t } = useTranslation()
  return <span>{t('common.cancel')}</span>
}

afterEach(async () => {
  await act(() => setLanguage('pt-BR'))
})

describe('language', () => {
  it('switches the screen right away, without restarting', async () => {
    const set = vi.spyOn(window.aureum.settings, 'set')
    render(<Label />)
    expect(screen.getByText('Cancelar')).toBeTruthy()
    await act(() => setLanguage('en'))
    expect(screen.getByText('Cancel')).toBeTruthy()
    expect(document.documentElement.lang).toBe('en')
    expect(set).toHaveBeenCalledWith({ language: 'en' })
    expect(languagePreference()).toBe('en')
  })

  it('"system" follows the OS language', async () => {
    await act(() => setLanguage('system'))
    expect(i18n.language).toBe(window.aureum.i18n.system)
  })

  it('formats dates and numbers in the current language', async () => {
    const date = new Date(2026, 0, 31)
    expect(dateFormat({ day: 'numeric', month: 'long' }).format(date)).toBe('31 de janeiro')
    expect(numberFormat({ maximumFractionDigits: 1 }).format(1.5)).toBe('1,5')
    await act(() => setLanguage('en'))
    expect(dateFormat({ day: 'numeric', month: 'long' }).format(date)).toBe('January 31')
    expect(numberFormat({ maximumFractionDigits: 1 }).format(1.5)).toBe('1.5')
  })
})
