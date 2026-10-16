/** Per-device media preferences (kept in localStorage: they only matter on this PC). */
export interface MediaPrefs {
  audioInput: string
  audioOutput: string
  videoInput: string
  noiseSuppression: boolean
}

const KEY = 'aureum.mediaPrefs'
const DEFAULTS: MediaPrefs = { audioInput: '', audioOutput: '', videoInput: '', noiseSuppression: true }

export function loadMediaPrefs(): MediaPrefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveMediaPrefs(prefs: MediaPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Storage unavailable: preferences just won't persist.
  }
}
