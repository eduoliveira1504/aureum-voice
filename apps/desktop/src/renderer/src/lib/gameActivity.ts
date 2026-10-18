import { sendRealtime } from './realtime'

/**
 * Reports "Jogando X" to the server: the game typed by the user while set, else the one the main
 * process detects. Only the name is sent, and only when it changes.
 */

let detected: string | null = null
let manual: string | null = null
let sent: string | null | undefined

function report(force = false): void {
  const name = manual ?? detected
  if (!force && name === sent) return
  // Not connected: 'ready' calls reportActivityAgain with the latest value.
  if (sendRealtime('activity.set', name ? { name } : null)) sent = name
}

/** Starts listening to the detector; returns the stop function. */
export function startActivityReporting(): () => void {
  const games = window.aureum.games
  void Promise.all([games.current(), games.getPrefs()]).then(([game, prefs]) => {
    detected = game
    manual = prefs.manual
    report()
  })
  const stop = games.onChange((game) => {
    detected = game
    report()
  })
  return () => {
    stop()
    sent = undefined
  }
}

/** After a reconnect: a new connection starts with no activity on the server. */
export function reportActivityAgain(): void {
  sent = undefined
  report(true)
}

/** The manual activity changed in settings. */
export function setManualActivity(name: string | null): void {
  manual = name
  report()
}
