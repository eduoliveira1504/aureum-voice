import { create } from 'zustand'

import { sendRealtime } from '../lib/realtime'

export interface Thumbnail {
  channelId: string
  image: string
}

interface ThumbnailState {
  /** Latest screen-share snapshot per user, for the server whose overview is open. */
  byUser: Record<string, Thumbnail>
}

export const useThumbnails = create<ThumbnailState>()(() => ({ byUser: {} }))

// The server sends thumbnails only to connections that said which overview they show.
let watched: string | null = null

/** Starts receiving a server's thumbnails (the overview is on screen); returns the cleanup. */
export function watchOverview(serverId: string): () => void {
  watched = serverId
  useThumbnails.setState({ byUser: {} })
  sendRealtime('overview.watch', { server_id: serverId })
  return () => {
    if (watched !== serverId) return
    watched = null
    useThumbnails.setState({ byUser: {} })
    sendRealtime('overview.watch', { server_id: null })
  }
}

/** After a reconnect: the new connection must be told again. */
export function rewatchOverview(): void {
  if (watched) sendRealtime('overview.watch', { server_id: watched })
}

export function applyThumbnail(data: { server_id: string; user_id: string; channel_id: string | null; image: string | null }): void {
  if (data.server_id !== watched) return
  useThumbnails.setState((s) => {
    const byUser = { ...s.byUser }
    if (data.image && data.channel_id) byUser[data.user_id] = { channelId: data.channel_id, image: data.image }
    else delete byUser[data.user_id]
    return { byUser }
  })
}
