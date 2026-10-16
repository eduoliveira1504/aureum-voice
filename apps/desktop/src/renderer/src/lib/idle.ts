import { sendRealtime } from './realtime'

/**
 * Auto-idle: after a while without keyboard or mouse input anywhere on the PC (not only in this
 * app, so playing a game doesn't count as away), the connection reports itself idle. The API
 * shows the user as idle once all their connections are.
 */

const IDLE_AFTER_SECONDS = 10 * 60
const POLL_MS = 15_000

let idle = false

/** Starts watching; returns the stop function. */
export function startIdleWatch(): () => void {
  const check = async (): Promise<void> => {
    const seconds = await window.aureum.system.idleSeconds().catch(() => 0)
    const now = seconds >= IDLE_AFTER_SECONDS
    if (now === idle) return
    idle = now
    sendRealtime('presence.idle', { idle })
  }
  const timer = setInterval(() => void check(), POLL_MS)
  return () => {
    clearInterval(timer)
    idle = false
  }
}

/** After a reconnect: a new connection starts active on the server. */
export function reportIdleAgain(): void {
  if (idle) sendRealtime('presence.idle', { idle })
}
