/**
 * macOS privacy permissions for the microphone, the camera and screen recording (block 3.21).
 * Microphone and camera can be asked for (the system dialog shows the Info.plist texts); screen
 * recording can't: macOS asks by itself the first time the app lists the screens, and after a
 * "no" only System Settings can change it. Elsewhere (Windows) everything reads as granted, as
 * before: the app never had to ask there.
 */
import { shell, systemPreferences } from 'electron'

import { isMediaKind, type MediaAccess, type MediaKind } from '../shared/mediaAccess'

const IS_MAC = process.platform === 'darwin'

const SETTINGS_PANE: Record<MediaKind, string> = {
  microphone: 'Privacy_Microphone',
  camera: 'Privacy_Camera',
  screen: 'Privacy_ScreenCapture'
}

const kindOf = (kind: unknown): MediaKind => {
  if (!isMediaKind(kind)) throw new Error('Invalid media kind')
  return kind
}

/** The current status, asking first (microphone, camera) when the person was never asked. */
export async function requestAccess(value: unknown): Promise<MediaAccess> {
  const kind = kindOf(value)
  if (!IS_MAC) return 'granted'
  const status = systemPreferences.getMediaAccessStatus(kind) as MediaAccess
  if (status !== 'not-determined' || kind === 'screen') return status
  return (await systemPreferences.askForMediaAccess(kind)) ? 'granted' : 'denied'
}

/** Opens System Settings › Privacy & Security on this permission's list. */
export function openAccessSettings(value: unknown): void {
  const kind = kindOf(value)
  if (!IS_MAC) return
  void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${SETTINGS_PANE[kind]}`)
}
