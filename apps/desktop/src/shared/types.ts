/** Types shared by the main process, the preload script and the renderer. */

export interface AppSettings {
  /** Base URL of the Aureum API, e.g. http://localhost:8000 */
  apiUrl: string
}

/** A screen or window that can be shared. */
export interface ShareSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  /** PNG data URL. */
  thumbnail: string
  icon: string | null
}

/** API exposed to the renderer as `window.aureum` by the preload script. */
export interface AureumBridge {
  session: {
    /** Refresh token, decrypted from OS-protected storage. */
    getRefreshToken(): Promise<string | null>
    /** Stores the refresh token encrypted, or clears it when null. */
    setRefreshToken(token: string | null): Promise<void>
    /** False when the OS can't encrypt; the session then lasts only until the app closes. */
    isPersistent(): Promise<boolean>
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  screen: {
    getSources(): Promise<ShareSource[]>
    /** Picks what the next getDisplayMedia() call captures, and whether it includes system audio. */
    select(sourceId: string, audio: boolean): Promise<void>
  }
}
