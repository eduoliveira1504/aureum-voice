import { describe, expect, it } from 'vitest'

import type { Badge } from '../lib/api'
import { badgeTitle, sortBadges } from './badges'

const badge = (key: string, rarity: Badge['rarity'], numbered = false): Badge => ({
  key,
  name: key,
  description: '',
  rarity,
  exclusive_beta: false,
  numbered,
  icon_svg: '<svg/>',
  icon_svg_small: '<svg/>'
})

const CATALOG = {
  hunter: badge('hunter', 'rara'),
  founder: badge('founder', 'mitica'),
  pioneer: badge('pioneer', 'mitica', true),
  builder: badge('builder', 'comum')
}

describe('sortBadges', () => {
  it('lists the rarest first, then the oldest, and skips unknown keys', () => {
    const shown = sortBadges(
      [
        { key: 'builder', number: null, granted_at: '2026-01-01T00:00:00Z' },
        { key: 'hunter', number: null, granted_at: '2026-02-01T00:00:00Z' },
        { key: 'pioneer', number: 7, granted_at: '2026-03-01T00:00:00Z' },
        { key: 'newer', number: null, granted_at: '2026-01-01T00:00:00Z' },
        { key: 'founder', number: null, granted_at: '2026-02-15T00:00:00Z' }
      ],
      CATALOG
    )
    expect(shown.map((s) => s.key)).toEqual(['founder', 'pioneer', 'hunter', 'builder'])
    expect(badgeTitle(shown[1])).toBe('pioneer #7')
    expect(badgeTitle(shown[0])).toBe('founder')
  })
})
