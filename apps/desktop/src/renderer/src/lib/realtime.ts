import { getApiBaseUrl, getFreshAccessToken } from './api'

export interface ServerEvent<T = any> {
  type: string
  data: T
}

export type ConnectionStatus = 'connecting' | 'online' | 'offline'

const PING_INTERVAL_MS = 25_000
// No answer (not even the pong) for this long: the connection is dead even if the socket hasn't
// noticed (a network change), so it's dropped and opened again.
const SILENCE_LIMIT_MS = PING_INTERVAL_MS * 2 + 5_000
const MAX_BACKOFF_MS = 30_000
// Server close code for an invalid/expired token.
const CLOSE_UNAUTHORIZED = 4401

let active: Realtime | null = null

/**
 * This app run, for the API: with several devices on one account, the one that joined a call
 * holds it (another device saying "not in a call" changes nothing). Random each run and never
 * stored: a restart leaves any call anyway.
 */
export const DEVICE_ID = crypto.randomUUID()

/** The connection of the signed-in session (set by the app shell). */
export function setActiveRealtime(realtime: Realtime | null): void {
  active = realtime
}

export function sendRealtime(type: string, data: unknown): boolean {
  return active?.send(type, data) ?? false
}

/** WebSocket client for /ws with heartbeats and automatic reconnection (exponential backoff). */
export class Realtime {
  private ws: WebSocket | null = null
  private stopped = true
  private attempt = 0
  private forceRefresh = false
  private pingTimer: ReturnType<typeof setInterval> | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly onEvent: (event: ServerEvent) => void,
    private readonly onStatus: (status: ConnectionStatus) => void
  ) {}

  start(): void {
    this.stopped = false
    void this.connect()
  }

  /** Sends a message if connected; returns false otherwise (state is re-sent on 'ready'). */
  send(type: string, data: unknown): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify({ type, data }))
    return true
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.retryTimer)
    clearInterval(this.pingTimer)
    this.ws?.close(1000)
    this.ws = null
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    this.onStatus('connecting')

    let token: string | null
    try {
      token = await getFreshAccessToken(this.forceRefresh)
    } catch {
      return this.scheduleRetry() // API unreachable
    }
    if (this.stopped) return
    if (!token) return this.onStatus('offline') // session is gone; the auth layer signs out
    this.forceRefresh = false

    const ws = new WebSocket(`${getApiBaseUrl().replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}&device=${DEVICE_ID}`)
    this.ws = ws
    let heardAt = Date.now()

    ws.onopen = () => {
      heardAt = Date.now()
      this.pingTimer = setInterval(() => {
        if (Date.now() - heardAt > SILENCE_LIMIT_MS) return this.drop(ws)
        ws.send(JSON.stringify({ type: 'ping' }))
      }, PING_INTERVAL_MS)
    }
    ws.onmessage = (message) => {
      heardAt = Date.now()
      const event = JSON.parse(message.data) as ServerEvent
      if (event.type === 'pong') return
      if (event.type === 'ready') {
        this.attempt = 0
        this.onStatus('online')
      }
      this.onEvent(event)
    }
    ws.onclose = (close) => {
      clearInterval(this.pingTimer)
      if (this.ws !== ws || this.stopped) return
      this.ws = null
      this.forceRefresh = close.code === CLOSE_UNAUTHORIZED
      this.onStatus('connecting')
      this.scheduleRetry()
    }
  }

  /** Gives up on a silent connection and opens a new one (its state is re-sent on 'ready'). */
  private drop(ws: WebSocket): void {
    clearInterval(this.pingTimer)
    if (this.ws !== ws) return
    this.ws = null
    ws.close()
    this.onStatus('connecting')
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt++)
    this.retryTimer = setTimeout(() => void this.connect(), delay)
  }
}
