import { describe, expect, it } from 'vitest'

import { currentApiUrl, isRetiredApiUrl } from './apiUrl'

const NEW = 'https://api.aureum-voice.duckdns.org'

describe('currentApiUrl', () => {
  it('moves the old Funnel address to the new default', () => {
    expect(currentApiUrl('https://user.tail394e17.ts.net', NEW)).toBe(NEW)
    expect(currentApiUrl('https://someone.tailabc.ts.net', NEW)).toBe(NEW)
  })

  it('keeps addresses people typed themselves', () => {
    expect(currentApiUrl('http://localhost:8000', NEW)).toBe('http://localhost:8000')
    expect(currentApiUrl('https://aureum.example.org', NEW)).toBe('https://aureum.example.org')
    expect(currentApiUrl('https://ts.net.example.org', NEW)).toBe('https://ts.net.example.org')
    expect(currentApiUrl(NEW, NEW)).toBe(NEW)
  })

  it("doesn't move to a default that is itself retired (a build without the new address)", () => {
    expect(currentApiUrl('https://user.tail394e17.ts.net', 'https://other.tail1.ts.net')).toBe(
      'https://user.tail394e17.ts.net'
    )
  })

  it('ignores what is not a URL', () => {
    expect(isRetiredApiUrl('not a url')).toBe(false)
    expect(isRetiredApiUrl('http://user.tail394e17.ts.net')).toBe(false)
  })
})
