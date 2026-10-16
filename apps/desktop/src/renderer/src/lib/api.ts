/**
 * Minimal API client. The access token lives only in memory; the refresh token is
 * kept encrypted by the main process. A 401 triggers a single refresh + retry.
 */

export interface User {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  banner_url: string | null
  bio: string | null
  accent_color: string | null
  created_at: string
}

export interface Me extends User {
  email: string
}

export type Theme = 'dark' | 'light' | 'system'

/** The status a user picks; invisible shows them as offline to others. */
export type UserStatus = 'online' | 'idle' | 'dnd' | 'invisible'
/** What others see of a user. */
export type Presence = 'online' | 'idle' | 'dnd' | 'offline'

/**
 * What a panel tab shows: 'overview', 'call', `channel:<id>` or `addon:<key>`.
 * The server validates the same shapes.
 */
export type PanelTab = string

export interface Panel {
  tabs: PanelTab[]
  active: PanelTab | null
}

/** One or two panels side by side; split is the first panel's share of the width. */
export interface PanelLayout {
  panels: Panel[]
  split: number
}

/** Per-user preferences synced through the server (GET/PATCH /users/me/settings). */
export interface UserSettings {
  theme: Theme
  accent_color: string
  sounds: { volume: number; events: Record<string, boolean> }
  status: UserStatus
  /** Server tabs in the top bar, in the user's order. */
  tab_order: string[]
  /** Servers taken off the top bar (still joined). */
  closed_tabs: string[]
  sidebar_collapsed: boolean
  /** Open panels per server id. */
  panel_layouts: Record<string, PanelLayout>
}

export type ChannelType = 'text' | 'voice' | 'dm' | 'group_dm'
export type Role = 'owner' | 'admin' | 'member'

export interface Channel {
  id: string
  server_id: string | null
  name: string | null
  type: ChannelType
  position: number
}

export interface Member {
  user: User
  role: Role
  joined_at: string
  status: Presence
  online: boolean
}

/** friend: accepted | incoming/outgoing: a pending request | blocked: blocked by me. */
export type FriendKind = 'friend' | 'incoming' | 'outgoing' | 'blocked'

export interface Friend {
  user: User
  kind: FriendKind
  since: string
  /** Only meaningful for friends; everyone else is 'offline'. */
  status: Presence
}

export interface CallParticipant {
  user_id: string
  /** null for the caller. */
  rung_at: string | null
  joined_at: string | null
  left_at: string | null
  declined_at: string | null
}

/** A private call in a DM or group; active while ended_at is null. */
export interface Call {
  id: string
  channel_id: string
  started_by: string | null
  started_at: string
  ended_at: string | null
  participants: CallParticipant[]
}

/** A 1:1 DM or a group DM. */
export interface Dm {
  id: string
  type: 'dm' | 'group_dm'
  name: string | null
  members: { user: User; status: Presence }[]
  last_message_id: number
  read: ReadState
  call: Call | null
  voice_states: VoiceState[]
}

export interface Server {
  id: string
  name: string
  icon_url: string | null
  owner_id: string
  created_at: string
}

export interface VoiceState {
  user_id: string
  channel_id: string
  muted: boolean
  deafened: boolean
  camera: boolean
  screen: boolean
}

/** The signed-in user's read state of a text channel. */
export interface ReadState {
  channel_id: string
  last_read_message_id: number
  unread_count: number
  mention_count: number
}

export interface ServerDetail extends Server {
  channels: Channel[]
  members: Member[]
  voice_states: VoiceState[]
  reads: ReadState[]
}

export interface Invite {
  code: string
  server_id: string
  expires_at: string | null
  max_uses: number | null
  uses: number
}

export interface Message {
  id: number
  channel_id: string
  author: User | null
  content: string
  attachments: unknown[]
  created_at: string
  edited_at: string | null
  /** Set on the line a private call leaves in its conversation. */
  call: Call | null
}

interface TokenPair {
  access_token: string
  refresh_token: string
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown
  ) {
    super(typeof detail === 'string' ? detail : `HTTP ${status}`)
  }
}

let baseUrl = ''
let accessToken: string | null = null
let refreshInFlight: Promise<boolean> | null = null
let onSessionExpired: () => void = () => {}

export function setApiBaseUrl(url: string): void {
  baseUrl = url.replace(/\/+$/, '')
}

export function getApiBaseUrl(): string {
  return baseUrl
}

/** Turns stored media paths (/api/media/...) into URLs on the configured server. */
export function mediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  return url.startsWith('/') ? `${baseUrl}${url}` : url
}

export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler
}

function send(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}/api${path}`, init)
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, body?.detail ?? null)
  return body as T
}

export async function storeTokens(tokens: TokenPair): Promise<void> {
  accessToken = tokens.access_token
  await window.aureum.session.setRefreshToken(tokens.refresh_token)
}

export async function clearTokens(): Promise<void> {
  accessToken = null
  await window.aureum.session.setRefreshToken(null)
}

/**
 * Exchanges the stored refresh token for a new pair. Concurrent callers share one request.
 * Returns false when there is no valid session; throws on network errors.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const refreshToken = await window.aureum.session.getRefreshToken()
      if (!refreshToken) return false
      const res = await send('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      })
      if (res.status === 401) {
        await clearTokens()
        return false
      }
      await storeTokens(await parse<TokenPair>(res))
      return true
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

function expiresSoon(token: string): boolean {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const { exp } = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')))
    return exp * 1000 - Date.now() < 30_000
  } catch {
    return true
  }
}

/** A valid access token (refreshed if needed), or null when there's no session. */
export async function getFreshAccessToken(force = false): Promise<string | null> {
  if (!force && accessToken && !expiresSoon(accessToken)) return accessToken
  return (await refreshSession()) ? accessToken : null
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Send the access token and refresh it on 401. Default true. */
  auth?: boolean
}

export async function api<T>(path: string, { method = 'GET', body, auth = true }: RequestOptions = {}): Promise<T> {
  const isForm = body instanceof FormData
  const doFetch = (): Promise<Response> => {
    const headers: Record<string, string> = {}
    // FormData sets its own multipart Content-Type (with the boundary).
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
    if (auth && accessToken) headers['Authorization'] = `Bearer ${accessToken}`
    const payload = body === undefined ? undefined : isForm ? body : JSON.stringify(body)
    return send(path, { method, headers, body: payload })
  }

  let res = await doFetch()
  if (res.status === 401 && auth) {
    if (await refreshSession()) {
      res = await doFetch()
    } else {
      onSessionExpired()
    }
  }
  return parse<T>(res)
}

export async function login(email: string, password: string): Promise<void> {
  await storeTokens(await api<TokenPair>('/auth/login', { method: 'POST', body: { email, password }, auth: false }))
}

export async function register(input: {
  username: string
  email: string
  password: string
  display_name?: string
  invite_code?: string
}): Promise<void> {
  await storeTokens(await api<TokenPair>('/auth/register', { method: 'POST', body: input, auth: false }))
}

export async function checkServer(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/health`, { signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch {
    return false
  }
}
