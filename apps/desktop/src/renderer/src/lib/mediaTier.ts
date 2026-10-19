/**
 * Streaming quality limits. The API sends the user's media tier with every voice token (see
 * apps/api/app/media.py); everything published here stays within it: camera and screen
 * resolution, and frame rate. The free tier is 720p for both, up to 30 fps.
 */

import { ScreenSharePresets, VideoPreset, VideoPresets } from 'livekit-client'

export type Resolution = '720p' | '1080p' | '1440p'

export interface MediaTier {
  plan: string
  max_screen: Resolution
  max_camera: Resolution
  max_fps: number
}

/** Used until a token says otherwise (and if an older API sends none). */
export const FREE_TIER: MediaTier = { plan: 'free', max_screen: '720p', max_camera: '720p', max_fps: 30 }

export type ScreenMode = 'detail' | 'motion'

/** The two ways to share a screen: what the picker offers and what each one sends. */
export const SCREEN_MODES: Record<ScreenMode, { label: string; fps: number; description: string }> = {
  detail: { label: 'Texto nítido', fps: 15, description: 'Prioriza a resolução: código, documentos, planilhas.' },
  motion: { label: 'Movimento', fps: 30, description: 'Prioriza a fluidez: jogos e vídeos.' }
}

const SIZES: Record<Resolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 }
}

// LiveKit's tuned screen presets; 1440p scales the 1080p bitrate by the extra pixels.
const SCREEN_BITRATE: Record<Resolution, Record<ScreenMode, number>> = {
  '720p': { detail: ScreenSharePresets.h720fps15.encoding.maxBitrate, motion: ScreenSharePresets.h720fps30.encoding.maxBitrate },
  '1080p': { detail: ScreenSharePresets.h1080fps15.encoding.maxBitrate, motion: ScreenSharePresets.h1080fps30.encoding.maxBitrate },
  '1440p': {
    detail: Math.round(ScreenSharePresets.h1080fps15.encoding.maxBitrate * 1.78),
    motion: Math.round(ScreenSharePresets.h1080fps30.encoding.maxBitrate * 1.78)
  }
}

const CAMERA_PRESETS: Record<Resolution, VideoPreset> = {
  '720p': VideoPresets.h720,
  '1080p': VideoPresets.h1080,
  '1440p': VideoPresets.h1440
}

export const screenSize = (tier: MediaTier): { width: number; height: number } => SIZES[tier.max_screen]

export const screenFps = (tier: MediaTier, mode: ScreenMode): number => Math.min(SCREEN_MODES[mode].fps, tier.max_fps)

/** The top layer of a screen share: the tier's resolution, the mode's frame rate (capped). */
export function screenPreset(tier: MediaTier, mode: ScreenMode): VideoPreset {
  const { width, height } = SIZES[tier.max_screen]
  return new VideoPreset(width, height, SCREEN_BITRATE[tier.max_screen][mode], screenFps(tier, mode))
}

/** Lower layer for whoever watches in a small tile (simulcast): sharp-but-slow or fluid-but-small. */
export const screenSmallLayer = (mode: ScreenMode): VideoPreset =>
  mode === 'motion' ? ScreenSharePresets.h360fps15 : ScreenSharePresets.h360fps3

/** The camera's top layer: the tier's resolution at up to its frame rate. */
export function cameraPreset(tier: MediaTier): VideoPreset {
  const preset = CAMERA_PRESETS[tier.max_camera]
  const fps = Math.min(preset.encoding.maxFramerate ?? 30, tier.max_fps)
  return new VideoPreset(preset.width, preset.height, preset.encoding.maxBitrate, fps)
}

/** A human summary for the picker ("720p · 15 fps"). */
export const describeScreen = (tier: MediaTier, mode: ScreenMode): string => `${tier.max_screen} · ${screenFps(tier, mode)} fps`
