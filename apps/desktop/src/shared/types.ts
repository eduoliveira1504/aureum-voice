/** Types shared by the main process, the preload script and the renderer. */

export interface AppSettings {
  /** Base URL of the Aureum API, e.g. http://localhost:8000 */
  apiUrl: string
  /** Closing the window hides it in the tray (the app stays connected) instead of quitting. */
  closeToTray: boolean
  /** Starts with Windows, hidden in the tray (installed app only). */
  openAtLogin: boolean
  /** The "still running in the tray" hint was shown once already. */
  trayHintShown: boolean
}

export type TrayStatus = 'online' | 'idle' | 'dnd' | 'invisible'

/** What the tray menu shows, reported by the app's window. */
export interface TrayState {
  signedIn: boolean
  muted: boolean
  deafened: boolean
  status: TrayStatus
}

/** What the tray menu asks the app's window to do. */
export type TrayCommand = { type: 'mute' } | { type: 'deafen' } | { type: 'status'; status: TrayStatus }

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

export type OverlaySize = 'small' | 'medium' | 'large'
export type OverlayCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/** Where the overlay box sits, in screen coordinates (DIPs). */
export interface OverlayBounds {
  x: number
  y: number
  width: number
  height: number
}

/** In-game overlay preferences. They stay on this PC: the position depends on its monitors. */
export interface OverlayPrefs {
  enabled: boolean
  /** Electron accelerators, e.g. "Control+Shift+F9". */
  toggleShortcut: string
  editShortcut: string
  /** null until placed: the top-left corner of the primary monitor. */
  bounds: OverlayBounds | null
  size: OverlaySize
  /** 30-100 (%). */
  opacity: number
  showCameras: boolean
  onlySpeaking: boolean
  /** Programs (file name without ".exe", lowercase) the overlay never shows over, on top of
   *  the bundled exceptions (browsers etc., see main/overlayExceptions.json). */
  hiddenApps: string[]
}

/** What the main process tells the app's window about the overlay. */
export interface OverlayState {
  prefs: OverlayPrefs
  /** Edit mode: the overlay takes clicks so it can be moved and resized. */
  editing: boolean
  /** Shortcuts another program already took (they don't work until changed). */
  failedShortcuts: string[]
  /** A short message on the overlay after a shortcut (e.g. "Overlay escondido"), or null. */
  notice: string | null
}

/** A downloaded update waiting for a restart. */
export interface UpdateState {
  ready: boolean
  version: string | null
}

/** What a bug report says about the app and the PC. */
export interface AppInfo {
  version: string
  /** e.g. "Windows 10.0.26200 (x64)" */
  os: string
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
  /** Attachments already downloaded, kept on disk by id (cleared on logout). */
  attachments: {
    get(id: string): Promise<Uint8Array | null>
    put(id: string, data: Uint8Array): Promise<void>
    clear(): Promise<void>
  }
  window: {
    /** Colors of the window buttons area over the top bar (hex: background, symbols). */
    setTitleBarColors(color: string, symbolColor: string): Promise<void>
    /** PNG of the app window as it looks right now. */
    capture(): Promise<Uint8Array>
  }
  app: {
    info(): Promise<AppInfo>
    /** The app's last log lines (in memory only, tokens and e-mails removed). */
    recentLogs(): Promise<string>
    /** Ctrl+Shift+R anywhere in the window ("Reportar problema"). */
    onReportProblem(listener: () => void): () => void
  }
  /** Push-to-talk key, read while a call needs it (even with a game focused). */
  ptt: {
    /** Starts watching the key (null stops); false when the key can't be read. */
    watch(key: string | null): Promise<boolean>
    onHeld(listener: (held: boolean) => void): () => void
  }
  updates: {
    getState(): Promise<UpdateState>
    /** Restarts into the downloaded update. */
    install(): Promise<void>
    onReady(listener: (state: UpdateState) => void): () => void
  }
  tray: {
    setState(state: TrayState): Promise<void>
    onCommand(listener: (command: TrayCommand) => void): () => void
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
  overlay: {
    getState(): Promise<OverlayState>
    /** Saves preferences; rejects when a new shortcut is invalid or taken by another program. */
    setPrefs(patch: Partial<OverlayPrefs>): Promise<OverlayState>
    setEditing(editing: boolean): Promise<void>
    /** Whether the app has something to show (a call is going on). */
    setActive(active: boolean): Promise<void>
    /** Moves/resizes the box while editing (saved when editing ends). */
    setBounds(bounds: OverlayBounds): Promise<void>
    /** Puts the box in a corner of the monitor it's on. */
    snap(corner: OverlayCorner): Promise<void>
    /** Pauses the global shortcuts (while Settings records a new one). */
    pauseShortcuts(paused: boolean): Promise<void>
    onState(listener: (state: OverlayState) => void): () => void
  }
}
