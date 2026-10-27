import { describe, expect, it } from 'vitest'

import { accountMessage, serverNotice } from './accountErrors'
import { ApiError } from './api'

const MOVED = 'O Aureum mudou de servidor. Atualize o app.'

describe('serverNotice', () => {
  it("shows the server's own words on a 503", () => {
    expect(serverNotice(new ApiError(503, MOVED))).toBe(MOVED)
    expect(accountMessage(new ApiError(503, MOVED))).toBe(MOVED)
  })

  it('falls back to the generic messages otherwise', () => {
    expect(serverNotice(new ApiError(503, null))).toBeNull()
    expect(serverNotice(new ApiError(500, 'boom'))).toBeNull()
    expect(serverNotice(new TypeError('Failed to fetch'))).toBeNull()
    expect(accountMessage(new ApiError(503, null))).toBe('Erro inesperado do servidor (503).')
  })
})
