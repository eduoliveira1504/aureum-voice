import { describe, expect, it } from 'vitest'

import { appKey } from '../shared/overlayRule'
import type { KnownGame } from '../shared/types'
import games from './games.json'
import overlayExceptions from './overlayExceptions.json'

// The bundled lists: games.json names the executable of the match itself, never a launcher or
// client, and the overlay exceptions win over it.
describe('bundled game lists', () => {
  const exes = (games as KnownGame[]).flatMap((g) => g.exe.map(appKey))

  it('has no game executable among the overlay exceptions', () => {
    const exceptions = new Set(overlayExceptions.map(appKey))
    expect(exes.filter((e) => exceptions.has(e))).toEqual([])
  })

  it('names each executable once', () => {
    const titled = new Set((games as KnownGame[]).filter((g) => g.title).flatMap((g) => g.exe.map(appKey)))
    const plain = exes.filter((e) => !titled.has(e))
    expect(plain.filter((e, i) => plain.indexOf(e) !== i)).toEqual([])
  })
})
