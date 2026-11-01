/** The app's Content-Security-Policy, as index.html sets it. */

import { describe, expect, it } from 'vitest'

import html from '../../index.html?raw'

const directive = (name: string): string[] => {
  const policy = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? ''
  return policy.split(';').map((d) => d.trim().split(/\s+/)).find(([key]) => key === name)?.slice(1) ?? []
}

describe('the policy', () => {
  // decodeSound fetches a blob URL: without this, sounds never play in a call.
  it('lets the app read its own blob URLs', () => {
    expect(directive('connect-src')).toContain('blob:')
    expect(directive('media-src')).toContain('blob:')
  })
})
