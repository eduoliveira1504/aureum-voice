/** The tour's engine and the first-time tips (block 3.16). */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { UserSettings } from '../lib/api'
import { DEFAULT_SETTINGS, useAppearance } from '../store/appearance'
import { useOnboarding } from '../store/onboarding'
import { FirstTimeTip, TourOverlay, type TourStep } from './Tour'

const steps: TourStep[] = [
  { id: 'hello', since: 1, title: 'Bem-vindo', text: 'Oi', next: 'Começar' },
  { id: 'tabs', since: 1, anchor: 'abas', title: 'Abas', text: 'As abas' },
  { id: 'gone', since: 1, anchor: 'nao-existe', title: 'Sumiu', text: '...' },
  { id: 'end', since: 1, title: 'Pronto', text: 'Fim' }
]

// jsdom lays nothing out: anchored elements get a box, the rest stays empty.
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.hasAttribute('data-tour') ? new DOMRect(100, 20, 200, 40) : new DOMRect(0, 0, 0, 0)
  })
  const update = vi.fn((patch: Partial<UserSettings>) => useAppearance.setState((s) => ({ settings: { ...s.settings, ...patch } })))
  useAppearance.setState({ settings: DEFAULT_SETTINGS, update } as never)
  useOnboarding.setState({ ready: true, tour: null, invite: false, tip: null })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const frame = (): Promise<void> => act(() => new Promise<void>((r) => setTimeout(r, 20)))

describe('the tour', () => {
  it('goes forward and back, with progress', async () => {
    render(
      <>
        <nav data-tour="abas" />
        <TourOverlay steps={steps} onEnd={() => {}} />
      </>
    )
    expect(screen.getByText('1/4')).toBeTruthy()
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Começar' })))
    await frame()
    expect(screen.getByRole('dialog', { name: 'Abas' })).toBeTruthy()
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Voltar' })))
    expect(screen.getByRole('dialog', { name: 'Bem-vindo' })).toBeTruthy()
  })

  it('is skipped with the button or Esc', () => {
    const onEnd = vi.fn()
    render(<TourOverlay steps={steps} onEnd={onEnd} />)
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Pular' })))
    act(() => fireEvent.keyDown(window, { key: 'Escape' }))
    expect(onEnd).toHaveBeenCalledTimes(2)
  })

  it('skips a step whose element never shows up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    render(
      <>
        <nav data-tour="abas" />
        <TourOverlay steps={steps.slice(1)} onEnd={() => {}} />
      </>
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Próximo' })))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300)
    })
    expect(screen.getByRole('dialog', { name: 'Pronto' })).toBeTruthy()
    expect(screen.queryByText('Sumiu')).toBeNull()
  })

  it('shows in the middle a step that may have no element', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    render(<TourOverlay steps={[{ ...steps[2], centerIfMissing: true }]} onEnd={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300)
    })
    expect(screen.getByRole('dialog', { name: 'Sumiu' })).toBeTruthy()
  })

  it('shows the Novidade mark on new steps', () => {
    render(<TourOverlay steps={steps.slice(0, 1)} news onEnd={() => {}} />)
    expect(screen.getByText('Novidade')).toBeTruthy()
  })
})

describe('first-time tips', () => {
  const tip = (key: string): ReactNode => <FirstTimeTip tip={key} anchor="abas" title={`Dica ${key}`} text="..." />

  it('shows once and is saved on Entendi', async () => {
    render(
      <>
        <nav data-tour="abas" />
        {tip('a')}
      </>
    )
    await frame()
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Entendi' })))
    expect(useAppearance.getState().settings.onboarding.tips_seen).toEqual(['a'])
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('shows one at a time, and the next one after Entendi', async () => {
    render(
      <>
        <nav data-tour="abas" />
        {tip('a')}
        {tip('b')}
        {tip('a')}
      </>
    )
    await frame()
    expect(screen.getAllByRole('note')).toHaveLength(1)
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Entendi' })))
    await frame()
    expect(screen.getByRole('note', { name: 'Dica: Dica b' })).toBeTruthy()
  })

  it('waits for the tour, and never shows a tip already seen', async () => {
    useOnboarding.setState({ tour: {} })
    render(
      <>
        <nav data-tour="abas" />
        {tip('a')}
      </>
    )
    await frame()
    expect(screen.queryByRole('note')).toBeNull()
    act(() => useAppearance.getState().update({ onboarding: { ...DEFAULT_SETTINGS.onboarding, tips_seen: ['a'] } }))
    act(() => useOnboarding.setState({ tour: null }))
    await frame()
    expect(screen.queryByRole('note')).toBeNull()
  })
})
