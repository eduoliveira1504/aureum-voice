/**
 * Minimal API client. The access token lives only in memory; the refresh token is
 * kept encrypted by the main process. A 401 triggers a single refresh + retry.
 */

export interface CustomStatus {
  text: string
  emoji: string | null
  expires_at: string | null
}

export interface FavoriteSong {
  title: string
  artist: string
  url: string | null
}

export interface ProfileLink {
  label: string
  url: string
}

export type AvatarFrame = 'none' | 'accent' | 'gold' | 'amethyst' | 'emerald' | 'ember' | 'sapphire'

export interface User {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  banner_url: string | null
  bio: string | null
  /** Profile card color. */
  accent_color: string | null
  pronouns: string | null
  custom_status: CustomStatus | null
  avatar_frame: AvatarFrame
  favorite_song: FavoriteSong | null
  links: ProfileLink[]
  /** Granted by the system: 'founder', 'beta'. */
  badges: string[]
  created_at: string
}

/** What someone is doing right now ("Jogando X"); comes over the WebSocket only. */
export interface Activity {
  type: 'playing'
  name: string
  started_at: string
}

export interface Me extends User {
  email: string
  /** The app owner's account (reads bug reports). */
  is_app_owner: boolean
}

/** A problem reported from the app; only the app owner lists them. */
export interface BugReport {
  id: string
  author: User | null
  description: string
  app_version: string
  os: string
  logs: string
  /** Protected: download it with fetchMedia. */
  screenshot_url: string | null
  resolved_at: string | null
  created_at: string
}

export type Theme = 'dark' | 'light' | 'system'

/** The status a user picks; invisible shows them as offline to others. */
export type UserStatus = 'online' | 'idle' | 'dnd' | 'invisible'
/** What others see of a user. */
export type Presence = 'online' | 'idle' | 'dnd' | 'offline'

/**
 * What a panel tab shows: 'overview', 'call' or `channel:<id>` (addons are channels too).
 * The server validates the same shapes (it still accepts the old `addon:<key>` placeholders).
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
  /** Tabs that show the member list next to them (remembered per tab). */
  members?: PanelTab[]
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
  /** How loud each person sounds in calls (volume %, 0-200) and local mutes, by user id. */
  user_audio: Record<string, UserAudio>
  /** Widths in px of resizable columns, by column key. */
  column_sizes: Record<string, number>
  /** Silenced channels and servers: no unread badges (mentions still count). */
  muted_places: string[]
}

export interface UserAudio {
  volume: number
  muted: boolean
}

export type ChannelType = 'text' | 'voice' | 'dm' | 'group_dm' | 'addon'

/** Allow/deny bits for a role (@everyone's id is the server's) or a member in one channel. */
export interface Override {
  target_type: 'role' | 'member'
  target_id: string
  allow: number
  deny: number
}

export interface Channel {
  id: string
  server_id: string | null
  name: string | null
  type: ChannelType
  position: number
  /** Addon channels only: which addon runs it, and its settings (shape set by the addon). */
  addon_key: string | null
  config: Record<string, unknown>
  /** Addon channels only: the text channel where the addon posts its system lines (null = off). */
  announce_channel_id?: string | null
  /** Server channels only. */
  overrides: Override[]
}

/** An addon the API runs (GET /addons). */
export interface AddonInfo {
  key: string
  name: string
  description: string
  icon: string
  /** Action name -> the channel permission bit it needs ("view" included). */
  permissions: Record<string, number>
  config_schema: Record<string, unknown> | null
  /** Whether it posts system lines to a text channel picked in the channel's settings. */
  announces: boolean
}

/** A server role. @everyone has the server's id and position 0; higher positions rank higher. */
export interface Role {
  id: string
  server_id: string
  name: string
  color: string | null
  icon_url: string | null
  position: number
  /** Bitfield of lib/permissions Perm. */
  permissions: number
  /** Shown as its own group in the member list. */
  hoist: boolean
  mentionable: boolean
}

export interface Member {
  user: User
  /** Strongest first; @everyone isn't listed. */
  role_ids: string[]
  joined_at: string
  /** Shown instead of the display name inside this server. */
  nickname: string | null
  /** Server mute / deafen by a moderator. */
  voice_muted: boolean
  voice_deafened: boolean
  status: Presence
  online: boolean
}

export interface Ban {
  user: User
  reason: string | null
  created_at: string
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
  /** Groups only: the group's picture. */
  icon_url: string | null
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
  banner_url: string | null
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
  /** Set by a moderator (server rooms only). */
  server_muted?: boolean
  server_deafened?: boolean
}

/** The signed-in user's read state of a text channel. */
export interface ReadState {
  channel_id: string
  last_read_message_id: number
  unread_count: number
  mention_count: number
}

export interface ServerDetail extends Server {
  /** Strongest first, @everyone last. */
  roles: Role[]
  /** Only the channels the signed-in user can see. */
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

/** A file sent in a conversation. `url` needs the access token (see fetchMedia). */
export interface Attachment {
  id: string
  filename: string
  /** Decided by the server from the bytes: images and videos show inline. */
  kind: 'image' | 'video' | 'file'
  content_type: string
  size: number
  url: string
}

export interface Message {
  id: number
  channel_id: string
  author: User | null
  content: string
  attachments: Attachment[]
  created_at: string
  edited_at: string | null
  /** Set on the line a private call leaves in its conversation. */
  call: Call | null
  /** Set on a system line posted by an addon ("moveu “X” para Feito"); content is empty. */
  system?: MessageSystem | null
}

export interface MessageSystem {
  addon_key: string
  /** The addon channel it came from. */
  source_channel_id: string
  /** Several quick actions by the same person go into one message, one line each. */
  lines: string[]
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
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
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

/** Downloads a protected media file (an attachment) with the access token. */
export async function fetchMedia(url: string, signal?: AbortSignal): Promise<Blob> {
  const doFetch = (): Promise<Response> =>
    fetch(mediaUrl(url)!, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, signal })
  let res = await doFetch()
  if (res.status === 401 && (await refreshSession())) res = await doFetch()
  if (!res.ok) throw new ApiError(res.status, null)
  return res.blob()
}

export interface Upload<T> {
  done: Promise<T>
  abort(): void
}

/** POSTs a file as multipart ("file") with upload progress (0-1), which fetch() can't report. */
export function uploadFile<T>(path: string, file: Blob, filename: string, onProgress: (fraction: number) => void): Upload<T> {
  let xhr: XMLHttpRequest | null = null
  let aborted = false
  const attempt = (token: string | null): Promise<{ status: number; body: unknown }> =>
    new Promise((resolve, reject) => {
      xhr = new XMLHttpRequest()
      xhr.open('POST', `${baseUrl}/api${path}`)
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
      xhr.onload = () => {
        let body: unknown = null
        try {
          body = JSON.parse(xhr!.responseText)
        } catch {
          // not JSON (e.g. a proxy error page)
        }
        resolve({ status: xhr!.status, body })
      }
      xhr.onerror = () => reject(new TypeError('Network error'))
      xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
      const form = new FormData()
      form.append('file', file, filename)
      xhr.send(form)
    })
  const done = (async () => {
    let res = await attempt(await getFreshAccessToken())
    if (res.status === 401 && !aborted) res = await attempt(await getFreshAccessToken(true))
    if (res.status < 200 || res.status >= 300) {
      const detail = (res.body as { detail?: unknown } | null)?.detail ?? null
      throw new ApiError(res.status, detail as string | null)
    }
    return res.body as T
  })()
  return {
    done,
    abort: () => {
      aborted = true
      xhr?.abort()
    }
  }
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
