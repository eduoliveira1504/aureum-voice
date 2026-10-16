/** Types shared by the main process, the preload script and the renderer. */

export interface AppSettings {
  /** Base URL of the Aureum API, e.g. http://localhost:8000 */
  apiUrl: string
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
}
