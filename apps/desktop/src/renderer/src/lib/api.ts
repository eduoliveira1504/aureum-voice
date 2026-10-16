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
  online: boolean
}

export interface Server {
  id: string
  name: string
  icon_url: string | null
  owner_id: string
  created_at: string
}

export interface ServerDetail extends Server {
  channels: Channel[]
  members: Member[]
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
  const doFetch = (): Promise<Response> => {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (auth && accessToken) headers['Authorization'] = `Bearer ${accessToken}`
    return send(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
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
