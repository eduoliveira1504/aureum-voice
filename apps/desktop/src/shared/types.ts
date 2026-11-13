/** Types shared by the main process, the preload script and the renderer. */

import type { LanguagePreference, Locale } from './i18n/locales'
import type { MediaAccess, MediaKind } from './mediaAccess'

export interface AppSettings {
  /** Base URL of the Aureum API, e.g. http://localhost:8000 */
  apiUrl: string
  /** Closing the window hides it in the tray (the app stays connected) instead of quitting. */
  closeToTray: boolean
  /** Starts with Windows (installed app only). */
  openAtLogin: boolean
  /** Started with Windows: open the window (through the loading screen) or stay in the tray. */
  loginStart: LoginStart
  /** The "still running in the tray" hint was shown once already. */
  trayHintShown: boolean
  /** The app's language on this computer (block 4.2.6). */
  language: LanguagePreference
}

export type LoginStart = 'window' | 'tray'

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

/** Where an overlay box sits, in screen coordinates (DIPs). */
export interface OverlayBounds {
  x: number
  y: number
  width: number
  height: number
}

/** The overlay's independent parts, each in a window of its own (see shared/overlayWidgets.ts). */
export type OverlayWidget = 'voice' | 'cameras' | 'notifications'
/** Column, row or grid of `perRow` columns. */
export type OverlayCameraLayout = 'horizontal' | 'vertical' | 'grid'

/** What only the cameras widget has (see cameraLayout in shared/overlayWidgets.ts). */
export interface OverlayCameraPrefs {
  layout: OverlayCameraLayout
  /** Width of each camera in px (16:9); `size` follows the nearest of the three shortcuts. */
  tileWidth: number
  /** Cameras shown at most (1-8); past it, "+N". Whoever is speaking always shows. */
  maxVisible: number
  /** Columns of the grid (1-8). */
  perRow: number
  /** Space between the cameras, px. */
  gap: number
  rounded: boolean
}

export interface OverlayWidgetPrefs {
  enabled: boolean
  size: OverlaySize
  /** 30-100 (%). */
  opacity: number
  /** Where the box sits for each monitor the game was on, by display id; none: the default place. */
  positions: Record<string, OverlayBounds>
}

export interface OverlayWidgets {
  voice: OverlayWidgetPrefs & { onlySpeaking: boolean }
  /** The box's size follows the cameras; `positions` only says where it's pinned. */
  cameras: OverlayWidgetPrefs & OverlayCameraPrefs
  /** `hideContent`: only "@fulano te mandou mensagem", never the message. */
  notifications: OverlayWidgetPrefs & { hideContent: boolean }
}

/** In-game overlay preferences. They stay on this PC: the positions depend on its monitors. */
export interface OverlayPrefs {
  enabled: boolean
  /** Electron accelerators, e.g. "Control+Shift+F9". */
  toggleShortcut: string
  editShortcut: string
  widgets: OverlayWidgets
  /** Programs (file name without ".exe", lowercase) the overlay never shows over, on top of
   *  the bundled exceptions (browsers etc., see shared/overlayExceptions.json). */
  hiddenApps: string[]
  /** Programs the user added as games in Settings > Overlay, on top of the known games. */
  games: string[]
  /** Programs the user said aren't games when asked ("Isso é um jogo?"): never asked again. */
  notGames: string[]
}

/** A change to the preferences: per widget, only the fields that change. */
export type OverlayPrefsPatch = Partial<Omit<OverlayPrefs, 'widgets'>> & {
  widgets?: { [W in OverlayWidget]?: Partial<OverlayWidgets[W]> }
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
  /** An unknown program filling the screen during a call: the overlay asks if it's a game. */
  ask: string | null
  /** The screen corner the cameras' box is pinned to, on the monitor the widgets are on. */
  cameraCorner: OverlayCorner
  /** The whole screen or a game's window is being streamed, so the overlay is hidden (3.24 A). */
  hiddenWhileSharing: boolean
  /** Windows leaves the overlay out of captures (10 2004+); older ones show it as a black box. */
  captureExclusion: boolean
}

/** A downloaded update waiting for a restart. */
export interface UpdateState {
  ready: boolean
  version: string | null
  /** macOS (block 3.21): the app can't update itself, so `ready` means "a newer version exists"
   * and install() opens the download page instead. */
  manual?: boolean
  /** The last check or download failed (it's tried again in 30 minutes): the window may offer
   * the download page if it knows of a newer version (block 4.1.4). */
  failed?: boolean
}

/** Where Mac users download a newer version (the landing page's download section). */
export const DOWNLOAD_PAGE = 'https://eduoliveira1504.github.io/aureum-voice/#baixar'

/** What a bug report says about the app and the PC. */
export interface AppInfo {
  version: string
  /** e.g. "Windows 10.0.26200 (x64)" */
  os: string
}

/** API exposed to the renderer as `window.aureum` by the preload script. */
export interface AureumBridge {
  /** The OS the app runs on ('win32', 'darwin'...), known synchronously (block 3.21). */
  platform: string
  /** The language chosen on this computer and the OS's one, known before the first render. */
  i18n: { preference: LanguagePreference; system: Locale }
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
  /** Right click on a chat image (3.24 B): the bytes the app already loaded. */
  images: {
    /** Puts a PNG on the clipboard as an image. */
    copy(png: Uint8Array): Promise<void>
    /** "Salvar como" with the original name and the right extension; false if cancelled. */
    save(data: Uint8Array, name: string, contentType: string): Promise<boolean>
  }
  window: {
    /** Colors of the window buttons area over the top bar (hex: background, symbols). */
    setTitleBarColors(color: string, symbolColor: string): Promise<void>
    /** PNG of the app window as it looks right now. */
    capture(): Promise<Uint8Array>
    /** Brings the app window to the front (also out of the tray or minimized). */
    show(): Promise<void>
  }
  /** The detached call window (block 3.20 B), opened by the app with window.open. */
  callWindow: {
    /** Whether it stays above other windows ("fixar por cima", saved). */
    getPinned(): Promise<boolean>
    setPinned(pinned: boolean): Promise<void>
    /** Moves it to this screen position (dragging it by any part that isn't a button). */
    move(x: number, y: number): Promise<void>
  }
  /** macOS privacy permissions (block 3.21); elsewhere always 'granted'. */
  media: {
    /** The status, asking first (microphone, camera) if the person was never asked. */
    access(kind: MediaKind): Promise<MediaAccess>
    /** Opens System Settings on this permission's list. */
    openSettings(kind: MediaKind): Promise<void>
  }
  app: {
    info(): Promise<AppInfo>
    /** The app's last log lines (in memory only, tokens and e-mails removed). */
    recentLogs(): Promise<string>
    /** Ctrl+Shift+R anywhere in the window ("Reportar problema"). */
    onReportProblem(listener: () => void): () => void
    /** The session is restored (or can't be): the loading screen may give way to the window.
     * online = the API answered. Only the first call counts. */
    ready(online: boolean): Promise<void>
  }
  /** Push-to-talk key, read while a call needs it (even with a game focused). */
  ptt: {
    /** Starts watching the key (null stops); false when the key can't be read. */
    watch(key: string | null): Promise<boolean>
    onHeld(listener: (held: boolean) => void): () => void
  }
  updates: {
    getState(): Promise<UpdateState>
    /** Asks the updater to check now (the API said a newer version is out). */
    check(): Promise<void>
    /** Restarts into the downloaded update (on the Mac: opens the download page). */
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
    /** Whether the system's sound can go with a share (always on Windows; macOS 14.2+). */
    systemAudio(): Promise<boolean>
  }
  overlay: {
    getState(): Promise<OverlayState>
    /** Saves preferences; rejects when a new shortcut is invalid or taken by another program. */
    setPrefs(patch: OverlayPrefsPatch): Promise<OverlayState>
    setEditing(editing: boolean): Promise<void>
    /** Whether the app has something to show (a call is going on). */
    setActive(active: boolean): Promise<void>
    /** Whether a notification is up, so its widget can show (outside a call too). */
    setNotifying(notifying: boolean): Promise<void>
    /** How many cameras the cameras widget draws, so its box fits them. */
    setCameraCount(count: number): Promise<void>
    /** The screen share stopped (the main process hides the overlay when one starts). */
    stopSharing(): Promise<void>
    /** Moves/resizes a widget's box while editing (saved when editing ends). */
    setBounds(widget: OverlayWidget, bounds: OverlayBounds): Promise<void>
    /** Puts a widget's box in a corner of the monitor it's on. */
    snap(widget: OverlayWidget, corner: OverlayCorner): Promise<void>
    /** Pauses the global shortcuts (while Settings records a new one). */
    pauseShortcuts(paused: boolean): Promise<void>
    /** Answers "Isso é um jogo?" about the program in OverlayState.ask. */
    answer(isGame: boolean): Promise<void>
    /** The pointer entered or left the question, so the overlay takes clicks there. */
    setAskHovered(hovered: boolean): Promise<void>
    onState(listener: (state: OverlayState) => void): () => void
  }
}

/** API exposed to the loading screen (splash.html) as `window.aureumSplash`: it only listens. */
export interface SplashBridge {
  /** The short line under the coin ("Procurando atualizações…"). */
  onStatus(listener: (text: string) => void): () => void
  /** Fade out: the main window is about to appear. */
  onLeave(listener: () => void): () => void
}
