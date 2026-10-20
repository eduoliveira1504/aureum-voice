/** Per-device media preferences (kept in localStorage: they only matter on this PC). */
export interface MediaPrefs {
  audioInput: string
  audioOutput: string
  videoInput: string
  /** RNNoise (see lib/micProcessor.ts). */
  noiseSuppression: boolean
  /** The browser's echo cancellation and automatic gain, on the capture itself. */
  echoCancellation: boolean
  autoGainControl: boolean
  /** Voice activity: 'auto' sends everything (RNNoise removes the noise); 'manual' cuts the mic
   * below `gateDb` (dBFS). */
  sensitivity: 'auto' | 'manual'
  gateDb: number
  /** How the mic opens in calls: always (voice activity) or while a key is held. */
  inputMode: 'voice' | 'ptt'
  /** The push-to-talk key (see lib/pushToTalk.ts); '' until one is picked. */
  pttKey: string
}

export const GATE_RANGE = { min: -80, max: -10 } as const

const KEY = 'aureum.mediaPrefs'
const DEFAULTS: MediaPrefs = {
  audioInput: '',
  audioOutput: '',
  videoInput: '',
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  sensitivity: 'auto',
  gateDb: -50,
  inputMode: 'voice',
  pttKey: ''
}

/** The voice gate's threshold for these prefs, or null when nothing should be cut (automatic
 * sensitivity, or push-to-talk, where the key decides). */
export function gateOf(prefs: MediaPrefs): number | null {
  return prefs.inputMode === 'voice' && prefs.sensitivity === 'manual' ? prefs.gateDb : null
}

/** Bluetooth headsets drop to a phone-quality profile while their mic is in use; Windows names
 * that endpoint "Hands-Free" (in Portuguese, sometimes "Viva-voz"). */
export const isHandsFree = (label: string): boolean => /hands[- ]?free|viva[- ]?voz|m[aã]os[- ]livres/i.test(label)

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
