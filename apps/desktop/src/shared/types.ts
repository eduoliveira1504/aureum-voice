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

/** A game the detector looks for: any of its executables running (and, when set, a main
 *  window title matching `title`, for games on generic runtimes like javaw.exe). */
export interface KnownGame {
  name: string
  exe: string[]
  title?: string
}

/** Game detection preferences. They stay on this PC: only the detected game's name is sent. */
export interface GamePrefs {
  enabled: boolean
  /** Games the user added, on top of the bundled list. */
  custom: KnownGame[]
  /** Game names never reported. */
  hidden: string[]
  /** Typed by the user; shown instead of the detected game while set. */
  manual: string | null
}

/** A program with a window open right now, offered when adding a game by hand. */
export interface RunningApp {
  exe: string
  title: string
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
  system: {
    /** Seconds since the last keyboard or mouse input anywhere on the PC. */
    idleSeconds(): Promise<number>
  }
  games: {
    getPrefs(): Promise<GamePrefs>
    setPrefs(patch: Partial<GamePrefs>): Promise<GamePrefs>
    /** The bundled list plus the user's games. */
    known(): Promise<KnownGame[]>
    /** Programs with an open window, to pick a game from. */
    running(): Promise<RunningApp[]>
    /** The game detected right now (hidden ones excluded), or null. */
    current(): Promise<string | null>
    /** Called whenever the detected game changes; returns an unsubscribe function. */
    onChange(listener: (game: string | null) => void): () => void
  }
  screen: {
    getSources(): Promise<ShareSource[]>
    /** Picks what the next getDisplayMedia() call captures, and whether it includes system audio. */
    select(sourceId: string, audio: boolean): Promise<void>
  }
}
