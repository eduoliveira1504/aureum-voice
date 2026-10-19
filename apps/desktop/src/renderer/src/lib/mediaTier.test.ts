import { describe, expect, it } from 'vitest'

import { cameraPreset, describeScreen, FREE_TIER, screenPreset, screenSize, type MediaTier } from './mediaTier'

describe('media tiers', () => {
  it('the free tier shares the screen at 720p: sharp text at 15 fps, motion at 30 fps', () => {
    expect(screenSize(FREE_TIER)).toEqual({ width: 1280, height: 720 })
    const detail = screenPreset(FREE_TIER, 'detail')
    const motion = screenPreset(FREE_TIER, 'motion')
    expect([detail.width, detail.height, detail.encoding.maxFramerate]).toEqual([1280, 720, 15])
    expect([motion.width, motion.height, motion.encoding.maxFramerate]).toEqual([1280, 720, 30])
    // Text gets less bitrate than motion, but not none.
    expect(detail.encoding.maxBitrate).toBeGreaterThan(0)
    expect(detail.encoding.maxBitrate).toBeLessThan(motion.encoding.maxBitrate)
    expect(describeScreen(FREE_TIER, 'detail')).toBe('720p · 15 fps')
  })

  it('the camera is capped at the tier too', () => {
    const camera = cameraPreset(FREE_TIER)
    expect([camera.width, camera.height]).toEqual([1280, 720])
    expect(camera.encoding.maxFramerate).toBeLessThanOrEqual(30)
  })

  it('a bigger plan raises the resolution, and the frame rate never passes the tier', () => {
    const plus: MediaTier = { plan: 'plus', max_screen: '1080p', max_camera: '1080p', max_fps: 24 }
    const motion = screenPreset(plus, 'motion')
    expect([motion.width, motion.height, motion.encoding.maxFramerate]).toEqual([1920, 1080, 24])
    expect(cameraPreset(plus).width).toBe(1920)
  })
})
