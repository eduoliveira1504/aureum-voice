import { describe, expect, it } from 'vitest'

import { macSupportsSystemAudio } from './mediaAccess'

describe('macSupportsSystemAudio', () => {
  it('sends system sound from macOS 14.2 on', () => {
    expect(macSupportsSystemAudio('14.2')).toBe(true)
    expect(macSupportsSystemAudio('14.2.1')).toBe(true)
    expect(macSupportsSystemAudio('15.0')).toBe(true)
    expect(macSupportsSystemAudio('26.1')).toBe(true)
  })

  it('shares without sound on older ones', () => {
    expect(macSupportsSystemAudio('14.1.2')).toBe(false)
    expect(macSupportsSystemAudio('13.6')).toBe(false)
    expect(macSupportsSystemAudio('')).toBe(false)
  })
})
