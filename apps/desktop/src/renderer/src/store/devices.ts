import { create } from 'zustand'

/** The PC's microphones, outputs and cameras ("communications" is a duplicate Windows entry). */
export interface Devices {
  audioinput: MediaDeviceInfo[]
  audiooutput: MediaDeviceInfo[]
  videoinput: MediaDeviceInfo[]
}

/** The device lists, kept current while something shows them (Settings, the call's menus) or a
 * call is on: a headset plugged in shows up right away. */
export const useDevices = create<{ devices: Devices | null }>()(() => ({ devices: null }))

let watchers = 0
let refreshing: Promise<void> | null = null

async function listDevices(): Promise<Devices> {
  let all = await navigator.mediaDevices.enumerateDevices()
  // Device names are hidden until media access is granted once.
  if (all.some((d) => d.kind === 'audioinput' && !d.label)) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      all = await navigator.mediaDevices.enumerateDevices()
    } catch {
      // No permission or no mic: list whatever we have.
    }
  }
  const of = (kind: MediaDeviceKind): MediaDeviceInfo[] => all.filter((d) => d.kind === kind && d.deviceId !== 'communications')
  return { audioinput: of('audioinput'), audiooutput: of('audiooutput'), videoinput: of('videoinput') }
}

export function refreshDevices(): Promise<void> {
  refreshing ??= listDevices()
    .then((devices) => useDevices.setState({ devices }))
    .catch(() => {})
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

const onChange = (): void => void refreshDevices()

/** Keeps the lists current until the returned function is called. */
export function watchDevices(): () => void {
  if (!navigator.mediaDevices) return () => {}
  if (watchers++ === 0) navigator.mediaDevices.addEventListener('devicechange', onChange)
  void refreshDevices()
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    if (--watchers === 0) navigator.mediaDevices.removeEventListener('devicechange', onChange)
  }
}

/** A device's name in a list, or null when it isn't there. */
export function deviceLabel(list: MediaDeviceInfo[] | undefined, deviceId: string): string | null {
  const device = list?.find((d) => d.deviceId === deviceId)
  return device ? device.label || 'Dispositivo sem nome' : null
}
