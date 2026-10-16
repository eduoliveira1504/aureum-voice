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
