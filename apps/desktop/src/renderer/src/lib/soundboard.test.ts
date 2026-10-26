import { Track, type Participant } from 'livekit-client'
import { describe, expect, it } from 'vitest'

import { isSoundboard, micPublication, playingSound, rms, speakingNow, SOUNDBOARD_TRACK } from './soundboard'

const pub = (trackName: string, isMuted = false, source = Track.Source.Microphone) => ({ trackName, isMuted, source })
const participant = (...pubs: ReturnType<typeof pub>[]): Participant =>
  ({ audioTrackPublications: new Map(pubs.map((p, i) => [`TR_${i}`, p])) }) as unknown as Participant

describe('the soundboard track', () => {
  it('is told apart from the mic by its name, whatever order they came in', () => {
    const sound = pub(SOUNDBOARD_TRACK)
    const mic = pub('microphone', true)
    expect(isSoundboard(sound)).toBe(true)
    expect(isSoundboard(mic)).toBe(false)
    expect(micPublication(participant(sound, mic))).toBe(mic)
    expect(micPublication(participant(sound))).toBeUndefined()
    expect(micPublication(participant(pub('', false, Track.Source.ScreenShareAudio)))).toBeUndefined()
  })

  it('counts as playing only while it is out and unmuted', () => {
    expect(playingSound(participant(pub('microphone'), pub(SOUNDBOARD_TRACK)))).toBe(true)
    expect(playingSound(participant(pub('microphone'), pub(SOUNDBOARD_TRACK, true)))).toBe(false)
    expect(playingSound(participant(pub('microphone')))).toBe(false)
  })
})

describe('who shows as speaking', () => {
  it("ignores LiveKit's level for someone playing a sound, and uses their mic instead", () => {
    // ana talks, bia only plays a sound, caio plays one and talks over it.
    const withSound = new Set(['bia', 'caio'])
    expect(speakingNow(['ana', 'bia', 'caio'], withSound, new Set(['caio']))).toEqual(['ana', 'caio'])
    expect(speakingNow(['bia'], withSound, new Set())).toEqual([])
    // Their mic measured as loud only counts while they have a sound playing.
    expect(speakingNow([], new Set(), new Set(['dani']))).toEqual([])
  })

  it('measures the level as root mean square', () => {
    expect(rms(new Float32Array(128))).toBe(0)
    expect(rms(new Float32Array(128).fill(0.5))).toBeCloseTo(0.5)
  })
})
