/** Per-device media preferences (kept in localStorage: they only matter on this PC). */
export interface MediaPrefs {
  audioInput: string
  audioOutput: string
  videoInput: string
  noiseSuppression: boolean
  /** How the mic opens in calls: always (voice activity) or while a key is held. */
  inputMode: 'voice' | 'ptt'
  /** The push-to-talk key (see lib/pushToTalk.ts); '' until one is picked. */
  pttKey: string
}

const KEY = 'aureum.mediaPrefs'
const DEFAULTS: MediaPrefs = {
  audioInput: '',
  audioOutput: '',
  videoInput: '',
  noiseSuppression: true,
  inputMode: 'voice',
  pttKey: ''
}

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
