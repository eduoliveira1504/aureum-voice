/**
 * When the in-game overlay may show: only over a game (docs/decisions/0024-overlay-games-and-watching.md).
 * Pure functions, shared by the main process (which decides) and Settings (which lists the games).
 */
// Programs that are never games (browsers, chat and music apps, launchers and game clients): the
// overlay never shows over them, even if one is added as a game by mistake. Edit the JSON to
// change the list.
import overlayExceptions from './overlayExceptions.json'
import type { KnownGame } from './types'

/** "C:\\Games\\Riot\\League of Legends.exe" or "League of Legends.exe" -> "league of legends":
 *  the form programs are compared in (file name, no ".exe", lowercase). */
export const appKey = (file: string): string =>
  (file.split(/[\\/]/).pop() ?? '').replace(/\.exe$/i, '').trim().toLowerCase()

export const OVERLAY_EXCEPTIONS: ReadonlySet<string> = new Set(overlayExceptions.map(appKey))

/**
 * The programs that count as games: the executables of the known games (bundled + the user's),
 * plus the ones the user added in Settings > Overlay. Games told apart by their window title
 * (Minecraft on javaw.exe) only count while game detection has found that very game, since the
 * overlay itself never reads window titles.
 */
export function gameApps(known: KnownGame[], detected: string | null, added: string[]): Set<string> {
  const keys = new Set(added.map(appKey))
  for (const game of known) {
    if (game.title && game.name !== detected) continue
    for (const exe of game.exe) keys.add(appKey(exe))
  }
  return keys
}

export interface OverlayTarget {
  /** The program in front (see appKey), or null when Windows won't say (e.g. some anti-cheats). */
  app: string | null
  games: Set<string>
  /** Never under the overlay, even if added as a game by mistake (OVERLAY_EXCEPTIONS and the app itself). */
  exceptions: ReadonlySet<string>
  /** "Ocultar overlay neste jogo". */
  hidden: string[]
  /** A known game is running (game detection), used when the program in front can't be read. */
  gameRunning: boolean
}

/** Whether the overlay may show over the program in front. Anything not known as a game is not. */
export function overGame({ app, games, exceptions, hidden, gameRunning }: OverlayTarget): boolean {
  if (app === null) return gameRunning
  return games.has(app) && !exceptions.has(app) && !hidden.includes(app)
}

/**
 * Whether a screen share would carry the overlay along (3.24 A): the whole screen, or the window of a
 * game (`windowApp` is its program, null when Windows won't say). The overlay hides while it lasts:
 * Windows can draw a hidden-and-shown protected window as a black box in the capture.
 */
export function shareCarriesOverlay(
  sourceId: string | null,
  windowApp: string | null,
  target: Omit<OverlayTarget, 'app'>
): boolean {
  if (!sourceId) return false
  if (sourceId.startsWith('screen:')) return true
  return sourceId.startsWith('window:') && overGame({ ...target, app: windowApp })
}
