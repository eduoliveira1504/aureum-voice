/** macOS privacy permissions the app depends on (block 3.21, see main/mediaAccess.ts). */

export type MediaKind = 'microphone' | 'camera' | 'screen'
/** What macOS answers (systemPreferences.getMediaAccessStatus). */
export type MediaAccess = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

export const isMediaKind = (value: unknown): value is MediaKind =>
  value === 'microphone' || value === 'camera' || value === 'screen'

/**
 * Whether to go ahead. Screen recording "not-determined" goes ahead: listing the screens is what
 * makes macOS ask. "unknown" too (an older macOS without the answer): the capture itself then
 * fails with the usual error.
 */
export const mayProceed = (kind: MediaKind, access: MediaAccess): boolean =>
  access === 'granted' || access === 'unknown' || (kind === 'screen' && access === 'not-determined')

/**
 * Whether this macOS can send the system's sound with a screen share: Electron captures it with
 * CoreAudio taps, from macOS 14.2 on (older ones share the screen without sound).
 */
export function macSupportsSystemAudio(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map((n) => Number.parseInt(n, 10) || 0)
  return major > 14 || (major === 14 && minor >= 2)
}

// The notices for a permission that's off live in the translation files (call.access.*).
