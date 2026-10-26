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
  /** Granted by the system or the app owner; what each looks like comes from GET /badges. */
  badges: HeldBadge[]
  /** The company's own accounts (@aureum): no beta badge, no invites. */
  is_official?: boolean
  /** A gold check next to the name ("Conta verificada"). */
  is_verified?: boolean
  /** A "BOT" tag next to the name ("Conta automatizada do Aureum"). */
  is_bot?: boolean
  created_at: string
}

export interface HeldBadge {
  key: string
  /** Numbered badges: the holder's place, e.g. Pioneiro #7. */
  number: number | null
  granted_at: string
  /** Next to the name, in this order (0 first); null: not featured. None featured: the rarest. */
  featured_position?: number | null
}

export type BadgeRarity = 'comum' | 'rara' | 'lendaria' | 'mitica'

/** A badge of the catalog (GET /badges). */
export interface Badge {
  key: string
  name: string
  description: string
  /** What earns it, shown to those who don't have it (older APIs: missing). */
  how_to_get?: string
  /** False: nobody can earn it anymore (beta over, numbers ran out, one of a kind). */
  available?: boolean
  rarity: BadgeRarity
  numbered: boolean
  /** Only granted while the beta runs. */
  exclusive_beta: boolean
  /** Same rarity: the lower one goes first next to a name (Fundador before Pioneiro). */
  priority?: number
  /** Full art (tooltips, big sizes) and the simplified one for 32 px and below. */
  icon_svg: string
  icon_svg_small: string
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
  /** Until the e-mailed code is typed: signs in, but creates no servers and has no invites. */
  email_verified: boolean
  /** A temporary password from the admin: nothing works until it's replaced. */
  must_change_password: boolean
  /** Set when the image was cropped in the app: the original is kept for "Ajustar posição". */
  avatar_crop?: ImageCrop | null
  banner_crop?: ImageCrop | null
}

/** The part of an image to keep, in the original's pixels after turning it `rotate`° clockwise. */
export interface ImageCrop {
  x: number
  y: number
  width: number
  height: number
  rotate: number
}

/** What confirming the e-mail brought (POST /auth/verify-email). */
export interface Confirmation {
  user: Me
  pioneer_number: number | null
  invites: number
  joined_official: boolean
}

/** One of the user's single-use account invites (Configurações › Convites). */
export interface MyInvite {
  code: string
  /** The invite page ({PUBLIC_BASE_URL}/convite/{code}), what gets shared. */
  url: string
  /** pending: someone signed up with it and hasn't confirmed their e-mail yet. */
  status: 'free' | 'pending' | 'used'
  used_by: { username: string; display_name: string; avatar_url: string | null } | null
}

/** The API's detail when an account must replace its temporary password first. */
export const PASSWORD_CHANGE_REQUIRED = 'Password change required'

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
  /** "Confirmar bug": real and being fixed. */
  confirmed_at?: string | null
  resolved_at: string | null
  /** "Fechar (não é bug)": closed without a fix. */
  dismissed_at?: string | null
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
  /** Official DM categories turned off (false); missing ones are on. */
  official_dm: Record<string, boolean>
  /** The app version whose "Novidades do Aureum" card in Home was dismissed. */
  news_dismissed: string | null
  /** Emoji picker: skin tone (0 default, 1-5 light to dark) and recent emojis, newest first. */
  emoji_tone: number
  recent_emojis: string[]
  /** "Confirmação de leitura" in 1:1 DMs; off hides it both ways. */
  read_receipts: boolean
  /** Sticker ids, newest first. */
  recent_stickers: string[]
}

/** What @aureum's DM is about. Security can't be turned off. */
export type OfficialCategory = 'seguranca' | 'insignias' | 'bugs' | 'convites' | 'novidades' | 'avisos' | 'eventos'

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
  /** The official DM with @aureum: read-only, pinned on top, its own look. */
  official?: boolean
  name: string | null
  /** Groups only: the group's picture. */
  icon_url: string | null
  members: { user: User; status: Presence }[]
  last_message_id: number
  read: ReadState
  call: Call | null
  voice_states: VoiceState[]
  /** 1:1 DMs: the last message the other person read, while both have read receipts on (null
   * otherwise; missing from older APIs). Changes come as "dm.read". */
  peer_read_message_id?: number | null
}

export interface Server {
  id: string
  name: string
  icon_url: string | null
  banner_url: string | null
  /** As on Me: set when the image was cropped in the app and can be re-cropped. */
  icon_crop?: ImageCrop | null
  banner_crop?: ImageCrop | null
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
  /** When they entered this room (missing on older API versions). */
  joined_at?: string | null
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
  /** Decided by the server from the bytes: images and videos show inline. 'voice': a voice message. */
  kind: 'image' | 'video' | 'file' | 'voice'
  content_type: string
  size: number
  url: string
  /** Voice messages: length and bar heights (0-100), measured while recording. */
  duration_ms?: number | null
  waveform?: number[] | null
  /** Images: size as shown, to save their room while they load (absent on older files). */
  width?: number | null
  height?: number | null
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
  /** Posted by @aureum. Only counts with an official author (author.is_official). */
  official?: { category: string; badge?: string; event?: OfficialEventRef } | null
  /** Carries something of an addon that lives in chats (a poll); apps that know the addon show
   * it instead of the content, a fallback for those that don't. */
  embed?: { addon_key: string; id: string } | null
  /** A reply: the original's id, and its quote while it exists (deleted: id only). */
  reply_to_id?: number | null
  reply_to?: ReplyRef | null
  /** A forward: a snapshot of the original; `content` is then the comment added to it. */
  forwarded_from?: ForwardedFrom | null
  /** Sent with the history and edits; null/absent means "not included" (keep what you have). */
  reactions?: Reaction[] | null
  /** Cards of its links, filled by the API a moment after it's sent (as message.updated). */
  link_previews?: LinkPreview[]
  /** A sticker message; its content is a fallback for older apps. */
  sticker?: MessageSticker | null
}

/** What a sticker message keeps of the sticker (it stays after the sticker is removed). */
export interface MessageSticker {
  id: string
  name: string
  pack_id: string
  /** Set for a server's own sticker: it only goes in that server. */
  server_id: string | null
  url: string
  width: number
  height: number
}

export interface Sticker {
  id: string
  name: string
  emoji: string | null
  width: number
  height: number
  /** /api/media/stickers/{id}: fetched with the token. */
  url: string
}

export interface StickerPack {
  id: string
  /** Empty for a server's pack (shown with the server's name). */
  name: string
  is_global: boolean
  server_id: string | null
  stickers: Sticker[]
}

/** A link's card. `image` is a /api/media path (the API fetched it, never the app). */
export interface LinkPreview {
  url: string
  kind: 'link' | 'youtube'
  site: string | null
  title: string | null
  description: string | null
  image: string | null
  image_width: number | null
  image_height: number | null
  /** YouTube only. */
  channel?: string | null
  video_id?: string | null
}

export interface Reaction {
  emoji: string
  count: number
  /** Who reacted, in order. */
  user_ids: string[]
}

export interface ForwardedFrom {
  content: string
  created_at: string
  /** A forwarded sticker. */
  sticker?: MessageSticker
  /** Where the original was. A private conversation says only that. */
  source:
    | { kind: 'dm' }
    | { kind: 'server'; server_id: string; server_name: string; channel_id: string; channel_name: string; message_id: number }
}

/** The original a reply quotes: its author and first 200 characters, or what it carries when it
 * has no text. */
export interface ReplyRef {
  id: number
  author: User | null
  content: string
  media: 'image' | 'gif' | 'video' | 'voice' | 'file' | 'poll' | 'embed' | 'sticker' | null
}

/** The event an official "eventos" notice is about (a reminder, a change...). */
export interface OfficialEventRef {
  id: string
  /** The events channel it's in. */
  channel_id: string
  server_id: string | null
  /** The voice room it happens in, if any. */
  room_id: string | null
  /** The occurrence's start; the app shows it in the user's own zone. */
  starts_at: string
}

/** GET /users/me/home: what the Home hub needs beyond what the app already holds. */
export interface HomeData {
  /** Unread messages that mention me, newest first. */
  mentions: { server_id: string; message: Message }[]
  /** Unread DMs and groups (not silenced) with the newest message from someone else. */
  dms: { channel_id: string; unread_count: number; message: Message }[]
  /** The first few of my tasks (GET /users/me/tasks has them all). */
  tasks: HomeTask[]
  tasks_total: number
  /** Newest message in a channel I can see, per server. */
  servers: { id: string; last_activity_at: string | null }[]
}

/** Something assigned to me in an addon (a Kanban card), not finished. */
export interface HomeTask {
  id: string
  addon_key: string
  workspace_id: string
  title: string
  /** Where it stands, in the addon's words (the card's column). */
  status: string
  /** Colors are label token names (--label-<color>). */
  labels: { name: string; color: string }[]
  due_date: string | null
  updated_at: string
  server_id: string
  server_name: string
  channel_id: string
  channel_name: string
}

/** GET /users/me/agenda: something with a date in an addon (an event, a card's due date). */
export interface AgendaItem {
  /** Unique per addon (a weekly event's occurrences each have one). */
  id: string
  workspace_id: string
  /** What to open in the addon (AddonViewProps.openItem). */
  item_id: string
  title: string
  /** The addon's word for it: "event", "card". */
  kind: string
  /** All-day items have `day` (YYYY-MM-DD); timed ones `starts_at` and maybe `ends_at`. */
  all_day: boolean
  day: string | null
  starts_at: string | null
  ends_at: string | null
  /** A label token name (--label-<color>), or null. */
  color: string | null
  done: boolean
  cancelled: boolean
  /** Assigned to me, or an event I said Vou or Talvez to. */
  mine: boolean
  addon_key: string
  server_id: string
  server_name: string
  channel_id: string
  channel_name: string
}

/** The agenda's query for [start, end): the app's own day boundaries go as ISO times. */
export function agendaPath(start: Date, end: Date, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), ...extra })
  return `/users/me/agenda?${params}`
}

export interface MessageSystem {
  addon_key: string
  /** The addon channel it came from. */
  source_channel_id: string
  /** Several quick actions by the same person go into one message, one line each. */
  lines: string[]
  /** A line that stands on its own ("Enquete encerrada: X venceu"): no author name before it. */
  standalone?: boolean
  /** The message it's about (the poll), in the same chat. */
  message_id?: number
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
        body: JSON.stringify({ refresh_token: refreshToken, device_id: installId() })
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

/** POSTs a file as multipart ("file", plus any `fields`) with upload progress (0-1), which
 * fetch() can't report. */
export function uploadFile<T>(
  path: string,
  file: Blob,
  filename: string,
  onProgress: (fraction: number) => void,
  fields: Record<string, string> = {}
): Upload<T> {
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
      for (const [name, value] of Object.entries(fields)) form.append(name, value)
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

const INSTALL_KEY = 'aureum.installId'

/**
 * A random id for this install, made once and kept. The API stores only a hash of it, to tell a
 * sign-in from a new install apart (the official DM's security notice); it says nothing else
 * about the PC.
 */
export function installId(): string | undefined {
  try {
    let id = localStorage.getItem(INSTALL_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(INSTALL_KEY, id)
    }
    return id
  } catch {
    return undefined // no storage: the API just can't tell installs apart
  }
}

export async function login(email: string, password: string): Promise<void> {
  const os = await window.aureum.app
    .info()
    .then((info) => info.os)
    .catch(() => undefined)
  await storeTokens(
    await api<TokenPair>('/auth/login', { method: 'POST', body: { email, password, device_id: installId(), os }, auth: false })
  )
}

export async function register(input: {
  username: string
  email: string
  password: string
  display_name?: string
  invite_code?: string
}): Promise<void> {
  await storeTokens(await api<TokenPair>('/auth/register', { method: 'POST', body: { ...input, device_id: installId() }, auth: false }))
}

/** Whether sign-up asks for an account invite (AUREUM_INVITE_ONLY). */
export async function authConfig(): Promise<{ invite_only: boolean }> {
  return api('/auth/config', { auth: false })
}

export function verifyEmail(code: string): Promise<Confirmation> {
  return api<Confirmation>('/auth/verify-email', { method: 'POST', body: { code } })
}

export function resendCode(): Promise<void> {
  return api<void>('/auth/resend-code', { method: 'POST' })
}

/** Fixes the address before confirming it; a new code goes there. */
export function changePendingEmail(email: string): Promise<Me> {
  return api<Me>('/auth/pending-email', { method: 'PATCH', body: { email } })
}

/** Ends the other sessions; this one keeps going with the new tokens. Without current: replacing
 * a temporary password. */
export async function changePassword(newPassword: string, currentPassword?: string): Promise<void> {
  await storeTokens(
    await api<TokenPair>('/auth/change-password', {
      method: 'POST',
      body: { new_password: newPassword, current_password: currentPassword ?? null }
    })
  )
}

/** Same answer whether or not the address has an account. */
export async function forgotPassword(email: string): Promise<void> {
  await api('/auth/forgot-password', { method: 'POST', body: { email }, auth: false })
}

/** Sets the new password with the e-mailed code and signs in. */
export async function resetPassword(email: string, code: string, newPassword: string): Promise<void> {
  await storeTokens(
    await api<TokenPair>('/auth/reset-password', {
      method: 'POST',
      body: { email, code, new_password: newPassword },
      auth: false
    })
  )
}

export function requestEmailChange(email: string, password: string): Promise<void> {
  return api<void>('/users/me/email', { method: 'POST', body: { email, password } })
}

export function confirmEmailChange(code: string): Promise<Me> {
  return api<Me>('/users/me/email/confirm', { method: 'POST', body: { code } })
}

export function myInvites(): Promise<MyInvite[]> {
  return api<MyInvite[]>('/users/me/invites')
}

export async function checkServer(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/health`, { signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch {
    return false
  }
}
