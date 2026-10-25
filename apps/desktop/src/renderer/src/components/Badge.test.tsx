import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Badge } from '../lib/api'
import { useBadges } from '../store/badges'
import { BadgeList, NameMarks } from './Badge'
import { BadgeInventory } from './BadgeInventory'

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

const held = (key: string, number: number | null = null, featured_position: number | null = null) => ({
  key,
  number,
  granted_at: '2026-10-18T12:00:00Z',
  featured_position
})

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

  it('the card shows the featured ones, then "+N" opens the inventory', () => {
    const many = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`b${i}`, badge(`b${i}`, `B${i}`, 'comum')]))
    useBadges.setState({ catalog: many })
    const onMore = vi.fn()
    render(<BadgeList badges={Object.keys(many).map((k) => held(k))} onMore={onMore} />)
    expect(screen.getAllByLabelText(/^B\d$/)).toHaveLength(2) // no choice: the two rarest
    fireEvent.click(screen.getByText('+5'))
    expect(onMore).toHaveBeenCalled()
    cleanup()
    render(<BadgeList badges={[held('b6', null, 1), held('b1'), held('b3', null, 0), held('b5', null, 2)]} />)
    expect(screen.getAllByLabelText(/^B\d$/).map((el) => el.getAttribute('aria-label'))).toEqual(['B3', 'B6', 'B5'])
    expect(screen.getByText('+1')).toBeTruthy()
  })

  it('lists use the small art and shine only on hover', () => {
    const { container } = render(<NameMarks user={{ badges: [held('pioneer', 1)] }} />)
    expect(screen.getByLabelText('Pioneiro #1')).toBeTruthy()
    expect(container.querySelector('img')!.getAttribute('src')).toContain(encodeURIComponent('small-pioneer'))
    expect(container.querySelector('.badge-shine-hover')).not.toBeNull()
  })

  it('the inventory shows every badge: yours first, the others locked with how to get them', () => {
    useBadges.setState({
      catalog: {
        pioneer: { ...badge('pioneer', 'Pioneiro', 'mitica'), exclusive_beta: true, available: false },
        founder: { ...badge('founder', 'Fundador', 'mitica'), exclusive_beta: true, available: false },
        builder: { ...badge('builder', 'Construtor', 'comum'), how_to_get: 'Crie um servidor com 5+ membros.' },
        bug_hunter: badge('bug_hunter', 'Caçador de bugs', 'rara')
      }
    })
    render(<BadgeInventory badges={[held('bug_hunter')]} />)
    const cards = screen.getAllByRole('listitem')
    // Ones you can still earn before the ones nobody can anymore.
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Caçador de bugs',
      'Construtor (não tem)',
      'Pioneiro (não tem)',
      'Fundador (não tem)'
    ])
    expect(cards[0].textContent).toContain('Recebida em 18 de outubro de 2026')
    expect(cards[1].textContent).toContain('Crie um servidor com 5+ membros.')
    expect(cards[2].textContent).toContain('Não disponível mais')
    // Someone else's inventory has nothing to click.
    expect(screen.queryByRole('button', { name: 'Destacar' })).toBeNull()
  })

  it('your own inventory can feature what you have', () => {
    const onFeature = vi.fn()
    render(<BadgeInventory badges={[held('bug_hunter'), held('pioneer', 3)]} featured={['pioneer']} onFeature={onFeature} />)
    // Pioneiro is featured already; only Caçador de bugs offers it.
    const buttons = screen.getAllByRole('button', { name: 'Destacar' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(onFeature).toHaveBeenCalledWith('bug_hunter')
    expect(screen.getByLabelText('Em destaque')).toBeTruthy()
  })
})

describe('next to a name', () => {
  beforeEach(() => {
    useBadges.setState({
      catalog: {
        founder: { ...badge('founder', 'Fundador', 'mitica'), priority: 0 },
        pioneer: { ...badge('pioneer', 'Pioneiro', 'mitica'), priority: 1 },
        bug_hunter: { ...badge('bug_hunter', 'Caçador de bugs', 'rara'), priority: 2 },
        builder: { ...badge('builder', 'Construtor', 'comum'), priority: 3 }
      }
    })
  })

  const order = (container: HTMLElement): string[] =>
    [...container.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label')!)

  it('an official account shows the check and the BOT tag, with their hints', () => {
    const { container } = render(<NameMarks user={{ badges: [], is_verified: true, is_bot: true }} />)
    expect(order(container)).toEqual(['Conta verificada', 'Conta automatizada do Aureum'])
    expect(screen.getByText('BOT')).toBeTruthy()
    fireEvent.mouseEnter(screen.getByLabelText('Conta verificada'))
    expect(screen.getByRole('tooltip').textContent).toBe('Conta verificada')
    fireEvent.mouseLeave(screen.getByLabelText('Conta verificada'))
    fireEvent.mouseEnter(screen.getByLabelText('Conta automatizada do Aureum'))
    expect(screen.getByRole('tooltip').textContent).toBe('Conta automatizada do Aureum')
  })

  it('a regular account shows neither', () => {
    const { container } = render(<NameMarks user={{ badges: [held('pioneer', 2)], is_verified: false, is_bot: false }} />)
    expect(screen.queryByLabelText('Conta verificada')).toBeNull()
    expect(screen.queryByText('BOT')).toBeNull()
    expect(order(container)).toEqual(['Pioneiro #2'])
    cleanup()
    expect(render(<NameMarks user={{ badges: [] }} />).container.innerHTML).toBe('')
  })

  it('shows the featured ones in the chosen order, up to three, even common ones', () => {
    const { container } = render(
      <NameMarks user={{ badges: [held('founder'), held('builder', null, 0), held('bug_hunter', null, 1), held('pioneer', 1)] }} />
    )
    expect(order(container)).toEqual(['Construtor', 'Caçador de bugs'])
  })

  it('shows only the two rarest badges, Fundador before Pioneiro, after the check and the tag', () => {
    const { container } = render(
      <NameMarks
        user={{
          is_verified: true,
          is_bot: true,
          badges: [
            held('builder'),
            held('bug_hunter'),
            { ...held('pioneer', 1), granted_at: '2026-01-01T00:00:00Z' },
            { ...held('founder'), granted_at: '2026-06-01T00:00:00Z' } // newer, still first
          ]
        }}
      />
    )
    expect(order(container)).toEqual(['Conta verificada', 'Conta automatizada do Aureum', 'Fundador', 'Pioneiro #1'])
  })

  it('never shrinks, so a long name is what gets cut', () => {
    const { container } = render(<NameMarks user={{ badges: [held('founder'), held('pioneer', 1)], is_verified: true }} />)
    const marks = container.firstElementChild!
    expect(marks.className).toContain('shrink-0')
    // Every mark keeps its size too.
    for (const el of marks.querySelectorAll(':scope > span')) expect(el.className).toContain('shrink-0')
  })

  it('the profile card shows the check and the tag without repeating the badges', () => {
    const { container } = render(<NameMarks user={{ badges: [held('founder')], is_verified: true, is_bot: true }} badges={false} />)
    expect(order(container)).toEqual(['Conta verificada', 'Conta automatizada do Aureum'])
  })
})
