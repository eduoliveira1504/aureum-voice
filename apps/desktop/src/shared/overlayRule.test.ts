import { describe, expect, it } from 'vitest'

import { appKey, gameApps, overGame } from './overlayRule'

const known = [
  { name: 'League of Legends', exe: ['League of Legends.exe'] },
  { name: 'Apex Legends', exe: ['r5apex.exe', 'r5apex_dx12.exe'] },
  { name: 'Minecraft', exe: ['javaw.exe'], title: '^Minecraft' }
]
const exceptions = new Set(['vivaldi', 'spotify', 'leagueclientux', 'steam'])

describe('appKey', () => {
  it('keeps the lowercase file name without .exe', () => {
    expect(appKey('C:\\Riot Games\\League of Legends\\Game\\League of Legends.exe')).toBe('league of legends')
    expect(appKey('r5apex_DX12.EXE')).toBe('r5apex_dx12')
    expect(appKey('vivaldi')).toBe('vivaldi')
  })
})

describe('gameApps', () => {
  it('lists every executable of the known games and the ones added by hand', () => {
    const games = gameApps(known, null, ['MyIndieGame.exe'])
    expect([...games].sort()).toEqual(['league of legends', 'myindiegame', 'r5apex', 'r5apex_dx12'])
  })

  it('counts title-matched games only while detection found them', () => {
    expect(gameApps(known, 'Minecraft', []).has('javaw')).toBe(true)
    expect(gameApps(known, 'League of Legends', []).has('javaw')).toBe(false)
  })
})

describe('overGame', () => {
  const games = gameApps(known, null, ['spotify'])
  const target = { games, exceptions, hidden: [] as string[], gameRunning: false }

  it('shows over a game in the list', () => {
    expect(overGame({ ...target, app: 'league of legends' })).toBe(true)
    expect(overGame({ ...target, app: 'r5apex_dx12' })).toBe(true)
  })

  it('hides over launchers, clients and any other app', () => {
    for (const app of ['leagueclientux', 'steam', 'vivaldi', 'whatsapp', 'notepad']) {
      expect(overGame({ ...target, app })).toBe(false)
    }
  })

  it('never shows over an exception, even one added as a game by mistake', () => {
    expect(overGame({ ...target, app: 'spotify' })).toBe(false)
  })

  it('hides over a game the user hid', () => {
    expect(overGame({ ...target, app: 'league of legends', hidden: ['league of legends'] })).toBe(false)
  })

  it('falls back to game detection when the program in front cannot be read', () => {
    expect(overGame({ ...target, app: null })).toBe(false)
    expect(overGame({ ...target, app: null, gameRunning: true })).toBe(true)
  })
})
