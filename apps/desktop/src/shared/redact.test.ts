import { describe, expect, it } from 'vitest'

import { redact } from './redact'

describe('redact', () => {
  it('removes tokens, credentials and e-mails', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'
    expect(redact(`WebSocket wss://x.ts.net/ws?token=${jwt} failed`)).toBe('WebSocket wss://x.ts.net/ws?token=[token] failed')
    expect(redact(`Authorization: Bearer abc.def-123`)).toBe('Authorization: Bearer [token]')
    expect(redact(`{"refresh_token":"${jwt}","x":1}`)).toBe('{"refresh_token":"[token]","x":1}')
    expect(redact('password=hunter22 user')).toBe('password=[removed] user')
    expect(redact('login failed for ana.souza+1@mail.com.br')).toBe('login failed for [e-mail]')
    expect(redact(`plain ${jwt}`)).toBe('plain [token]')
  })

  it('keeps ordinary lines', () => {
    expect(redact('[warn] Key watch unavailable')).toBe('[warn] Key watch unavailable')
  })
})
