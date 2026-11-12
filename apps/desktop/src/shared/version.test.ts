import { describe, expect, it } from 'vitest'

import { compareVersions, isNewer } from './version'

describe('versions', () => {
  it('orders the betas by number, not as text', () => {
    expect(isNewer('0.2.0-beta.10', '0.2.0-beta.9')).toBe(true)
    expect(isNewer('0.2.0-beta.9', '0.2.0-beta.10')).toBe(false)
    expect(isNewer('0.2.0-beta.11', '0.2.0-beta.8')).toBe(true)
  })

  it('handles the lettered betas and the final release', () => {
    expect(isNewer('0.2.0-beta.7.b', '0.2.0-beta.7')).toBe(true)
    expect(isNewer('0.2.0-beta.8', '0.2.0-beta.7.b')).toBe(true)
    expect(isNewer('0.2.0', '0.2.0-beta.10')).toBe(true)
    expect(isNewer('0.2.0-beta.10', '0.2.0')).toBe(false)
  })

  it('the same version, or something unreadable, is never newer', () => {
    expect(compareVersions('v0.2.0-beta.10', '0.2.0-beta.10')).toBe(0)
    expect(isNewer('0.2.0-beta.10', '0.2.0-beta.10')).toBe(false)
    expect(isNewer('nonsense', '0.2.0-beta.10')).toBe(false)
    expect(compareVersions('nonsense', '1.0.0')).toBeNull()
  })
})
