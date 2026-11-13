import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { setLanguage } from '../lib/i18n'
import { LanguageSettings } from './LanguageSettings'

afterEach(async () => {
  await act(() => setLanguage('pt-BR'))
})

describe('LanguageSettings', () => {
  it('offers the system language, Portuguese and English', () => {
    render(<LanguageSettings />)
    expect(screen.getByRole('radio', { name: 'Seguir o sistema (Português (Brasil))' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Português (Brasil)' })).toHaveProperty('checked', true)
    expect(screen.getByRole('radio', { name: 'English' })).toBeTruthy()
  })

  it('switches the screen to English right away', async () => {
    render(<LanguageSettings />)
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: 'English' })))
    expect(screen.getByText('App language')).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'English' })).toHaveProperty('checked', true)
  })
})
