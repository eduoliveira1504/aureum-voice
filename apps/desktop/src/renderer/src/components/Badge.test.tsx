import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Badge } from '../lib/api'
import { useBadges } from '../store/badges'
import { BadgeList, BadgeSummary, TopBadge } from './Badge'
import { BadgesPage } from './BadgesPage'

const badge = (key: string, name: string, rarity: Badge['rarity']): Badge => ({
  key,
  name,
  description: `Sobre ${name}`,
  rarity,
  exclusive_beta: false,
  numbered: key === 'pioneer',
  icon_svg: `<svg data-art="full-${key}"/>`,
  icon_svg_small: `<svg data-art="small-${key}"/>`
})

const held = (key: string, number: number | null = null) => ({ key, number, granted_at: '2026-10-18T12:00:00Z' })

beforeEach(() => {
  useBadges.setState({
    catalog: {
      pioneer: badge('pioneer', 'Pioneiro', 'mitica'),
      bug_hunter: badge('bug_hunter', 'Caçador de bugs', 'rara')
    }
  })
})

describe('badges', () => {
  it('lists the rarest first and explains each one on hover', () => {
    const { container } = render(<BadgeList badges={[held('bug_hunter'), held('pioneer', 7)]} />)
    const icons = screen.getAllByLabelText(/Pioneiro #7|Caçador de bugs/)
    expect(icons.map((el) => el.getAttribute('aria-label'))).toEqual(['Pioneiro #7', 'Caçador de bugs'])
    // Only the mythic one shines, and the card's always do (not hover-only).
    expect(container.querySelectorAll('.badge-shine')).toHaveLength(1)
    expect(container.querySelector('.badge-shine-hover')).toBeNull()

    fireEvent.mouseEnter(icons[0])
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.textContent).toContain('Pioneiro #7')
    expect(tooltip.textContent).toContain('Mítica')
    expect(tooltip.textContent).toContain('Sobre Pioneiro')
    expect(tooltip.textContent).toContain('18 de outubro de 2026')
  })

  it('shows "+N" past five badges', () => {
    const many = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`b${i}`, badge(`b${i}`, `B${i}`, 'comum')]))
    useBadges.setState({ catalog: many })
    render(<BadgeList badges={Object.keys(many).map((k) => held(k))} />)
    expect(screen.getAllByLabelText(/^B\d$/)).toHaveLength(5)
    expect(screen.getByText('+2')).toBeTruthy()
  })

  it('lists use the small art and shine only on hover', () => {
    const { container } = render(<TopBadge badges={[held('bug_hunter'), held('pioneer', 1)]} />)
    expect(screen.getByLabelText('Pioneiro #1')).toBeTruthy()
    expect(container.querySelector('img')!.getAttribute('src')).toContain(encodeURIComponent('small-pioneer'))
    expect(container.querySelector('.badge-shine-hover')).not.toBeNull()
  })

  it('the summary in Meu perfil counts them and opens the page', () => {
    const onOpen = vi.fn()
    render(<BadgeSummary badges={[held('bug_hunter'), held('pioneer', 1)]} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('2 insígnias'))
    expect(onOpen).toHaveBeenCalled()
    cleanup()
    render(<BadgeSummary badges={[]} onOpen={onOpen} />)
    expect(screen.getByText('Nenhuma insígnia ainda')).toBeTruthy()
  })

  it('the page shows every badge: the ones you have first, the others locked', () => {
    useBadges.setState({
      catalog: {
        pioneer: { ...badge('pioneer', 'Pioneiro', 'mitica'), exclusive_beta: true },
        founder: { ...badge('founder', 'Fundador', 'mitica'), exclusive_beta: true },
        bug_hunter: badge('bug_hunter', 'Caçador de bugs', 'rara')
      }
    })
    render(<BadgesPage badges={[held('bug_hunter')]} onBack={() => {}} />)
    const cards = screen.getAllByRole('listitem')
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Caçador de bugs',
      'Pioneiro (você não tem)',
      'Fundador (você não tem)'
    ])
    expect(cards[0].textContent).toContain('Recebida em 18 de outubro de 2026')
    expect(cards[1].textContent).toContain('Só durante o beta')
    expect(screen.getByText(/Você tem 1 de 3/)).toBeTruthy()
  })
})
