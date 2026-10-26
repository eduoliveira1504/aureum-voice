import { Track } from 'livekit-client'
import { beforeEach, describe, expect, it } from 'vitest'

import { SOUNDBOARD_TRACK } from '../lib/soundboard'
import { useAppearance } from './appearance'
import { useVoice, wantsTrack } from './voice'

const pub = (source: Track.Source): { source: Track.Source } => ({ source })

describe('what the call receives', () => {
  beforeEach(() => useVoice.setState({ watching: [] }))

  it('receives microphones and cameras right away', () => {
    expect(wantsTrack(pub(Track.Source.Microphone), 'ana')).toBe(true)
    expect(wantsTrack(pub(Track.Source.Camera), 'ana')).toBe(true)
  })

  it("receives nothing of someone's screen share before Assistir", () => {
    expect(wantsTrack(pub(Track.Source.ScreenShare), 'ana')).toBe(false)
    expect(wantsTrack(pub(Track.Source.ScreenShareAudio), 'ana')).toBe(false)
  })

  it('receives the video and audio of the screen being watched, and only that one', () => {
    useVoice.getState().watchScreen('ana')
    expect(wantsTrack(pub(Track.Source.ScreenShare), 'ana')).toBe(true)
    expect(wantsTrack(pub(Track.Source.ScreenShareAudio), 'ana')).toBe(true)
    expect(wantsTrack(pub(Track.Source.ScreenShare), 'bia')).toBe(false)
  })

  it('stops receiving it with Parar de assistir', () => {
    useVoice.getState().watchScreen('ana')
    useVoice.getState().stopWatching('ana')
    expect(wantsTrack(pub(Track.Source.ScreenShare), 'ana')).toBe(false)
    expect(wantsTrack(pub(Track.Source.ScreenShareAudio), 'ana')).toBe(false)
  })
})

describe("others' sounds", () => {
  it('are received unless "Silenciar sons dos outros" is on', () => {
    const sound = { source: Track.Source.Microphone, trackName: SOUNDBOARD_TRACK }
    expect(wantsTrack(sound, 'ana')).toBe(true)
    useAppearance.setState((s) => ({ settings: { ...s.settings, soundboard_muted: true } }))
    expect(wantsTrack(sound, 'ana')).toBe(false)
    // The mic itself still comes.
    expect(wantsTrack({ source: Track.Source.Microphone, trackName: 'microphone' }, 'ana')).toBe(true)
    useAppearance.setState((s) => ({ settings: { ...s.settings, soundboard_muted: false } }))
  })

  it("can't be played outside a call, or while deafened", async () => {
    const sound = { id: 'b', server_id: 's1', name: 'buzina', emoji: null, volume: 100, duration_ms: 1000, url: '/api/media/sounds/b' }
    await useVoice.getState().playBoardSound(sound)
    expect(useVoice.getState().boardSound).toBeNull()
    useVoice.setState({ phase: 'connected', serverId: 's1', deafened: true })
    await useVoice.getState().playBoardSound(sound)
    expect(useVoice.getState().boardSound).toBeNull()
    useVoice.setState({ phase: 'idle', serverId: null, deafened: false })
  })
})

describe('volumes and devices outside a call', () => {
  beforeEach(() => localStorage.clear())

  it('saves the mic and output volumes, kept within 0-200 %', async () => {
    const { loadMediaPrefs } = await import('../lib/mediaPrefs')
    expect(loadMediaPrefs()).toMatchObject({ inputVolume: 100, outputVolume: 100 })
    useVoice.getState().setVolume('inputVolume', 140)
    useVoice.getState().setVolume('outputVolume', 250)
    expect(loadMediaPrefs()).toMatchObject({ inputVolume: 140, outputVolume: 200 })
  })

  it('keeps the picked device as the preference', async () => {
    const { loadMediaPrefs } = await import('../lib/mediaPrefs')
    await useVoice.getState().switchDevice('audioinput', 'headset')
    await useVoice.getState().switchDevice('videoinput', 'webcam')
    expect(loadMediaPrefs()).toMatchObject({ audioInput: 'headset', videoInput: 'webcam' })
  })
})
