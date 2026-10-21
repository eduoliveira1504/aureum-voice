import { create } from 'zustand'

import { sendRealtime } from '../lib/realtime'

export interface Thumbnail {
  serverId: string
  channelId: string
  image: string
}

interface ThumbnailState {
  /** Latest screen-share snapshot per user, for the servers being watched. */
  byUser: Record<string, Thumbnail>
}

export const useThumbnails = create<ThumbnailState>()(() => ({ byUser: {} }))

/** The Home hub watches at most this many servers (the API refuses more). */
export const HOME_WATCH_MAX = 6

// The server sends thumbnails only to connections that said what they show: a server's
// overview, and the servers of the Home hub's live cards on screen.
let overview: string | null = null
let home: string[] = []

const watched = (serverId: string): boolean => serverId === overview || home.includes(serverId)

/** Forgets the thumbnails of servers nothing shows anymore. */
function prune(): void {
  useThumbnails.setState((s) => ({ byUser: Object.fromEntries(Object.entries(s.byUser).filter(([, t]) => watched(t.serverId))) }))
}

/** Starts receiving a server's thumbnails (the overview is on screen); returns the cleanup. */
export function watchOverview(serverId: string): () => void {
  overview = serverId
  prune()
  sendRealtime('overview.watch', { server_id: serverId })
  return () => {
    if (overview !== serverId) return
    overview = null
    prune()
    sendRealtime('overview.watch', { server_id: null })
  }
}

/** The Home hub shows live cards of these servers (at most HOME_WATCH_MAX); returns the cleanup. */
export function watchHome(serverIds: string[]): () => void {
  const ids = serverIds.slice(0, HOME_WATCH_MAX)
  home = ids
  prune()
  sendRealtime('home.watch', { server_ids: ids })
  return () => {
    if (home !== ids) return
    home = []
    prune()
    sendRealtime('home.watch', { server_ids: [] })
  }
}

/** After a reconnect: the new connection must be told again. */
export function rewatchOverview(): void {
  if (overview) sendRealtime('overview.watch', { server_id: overview })
  if (home.length) sendRealtime('home.watch', { server_ids: home })
}

export function applyThumbnail(data: { server_id: string; user_id: string; channel_id: string | null; image: string | null }): void {
  if (!watched(data.server_id)) return
  useThumbnails.setState((s) => {
    const byUser = { ...s.byUser }
    if (data.image && data.channel_id) byUser[data.user_id] = { serverId: data.server_id, channelId: data.channel_id, image: data.image }
    else delete byUser[data.user_id]
    return { byUser }
  })
}
