import { create } from 'zustand'

import { api } from '../../lib/api'
import type { ServerEvent } from '../../lib/realtime'

export type Background = 'plain' | 'grid'

export interface BoardSummary {
  id: string
  name: string
  background: Background
  version: number
  /** Names the current picture: fetch it with thumbnailUrl(). */
  thumbnail: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

interface BoardList {
  boards: BoardSummary[]
  can_edit: boolean
}

/** An Excalidraw element as the API keeps it (the editor has the full type). */
export interface SceneElement {
  id: string
  type: string
  version: number
  versionNonce: number
  isDeleted?: boolean
  fileId?: string | null
  [field: string]: unknown
}

export interface BoardScene extends BoardSummary {
  elements: SceneElement[]
  can_edit: boolean
}

export const whiteboardPath = (channelId: string, path = ''): string => `/addons/whiteboard/channels/${channelId}${path}`

/** The board's picture, fetched with the token (fetchMedia). */
export const thumbnailUrl = (channelId: string, board: BoardSummary): string | null =>
  board.thumbnail ? `/api${whiteboardPath(channelId, `/boards/${board.id}/thumbnail`)}?v=${board.thumbnail}` : null

const newestFirst = (a: BoardSummary, b: BoardSummary): number => b.updated_at.localeCompare(a.updated_at)
const upsert = (boards: BoardSummary[], board: BoardSummary): BoardSummary[] =>
  [...boards.filter((b) => b.id !== board.id), board].sort(newestFirst)

interface WhiteboardState {
  /** By channel id. */
  lists: Record<string, BoardList>
  load(channelId: string): Promise<void>
  /** Applies an `addon.whiteboard.board.*` event. */
  apply(type: string, data: Record<string, unknown>): void
  create(channelId: string, name: string): Promise<BoardSummary>
  update(channelId: string, boardId: string, fields: Partial<{ name: string; background: Background; archived: boolean }>): Promise<void>
  duplicate(channelId: string, boardId: string): Promise<BoardSummary>
}

export const useWhiteboard = create<WhiteboardState>()((set) => {
  const put = (channelId: string, board: BoardSummary): void =>
    set((s) => {
      const list = s.lists[channelId]
      return list ? { lists: { ...s.lists, [channelId]: { ...list, boards: upsert(list.boards, board) } } } : s
    })
  return {
    lists: {},

    load: async (channelId) => {
      const list = await api<BoardList>(whiteboardPath(channelId, '/boards'))
      set((s) => ({ lists: { ...s.lists, [channelId]: list } }))
    },

    apply: (type, data) => {
      if (type === 'addon.whiteboard.board.created' || type === 'addon.whiteboard.board.updated') {
        put(data.channel_id as string, data as unknown as BoardSummary)
      }
    },

    create: async (channelId, name) => {
      const board = await api<BoardSummary>(whiteboardPath(channelId, '/boards'), { method: 'POST', body: { name } })
      put(channelId, board)
      return board
    },

    update: async (channelId, boardId, fields) => {
      put(channelId, await api<BoardSummary>(whiteboardPath(channelId, `/boards/${boardId}`), { method: 'PATCH', body: fields }))
    },

    duplicate: async (channelId, boardId) => {
      const board = await api<BoardSummary>(whiteboardPath(channelId, `/boards/${boardId}/duplicate`), { method: 'POST' })
      put(channelId, board)
      return board
    }
  }
})

/** Live events of an open board (strokes, cursors, who's there) and 'ready' after reconnecting:
 * the editor listens while it's open. They don't go through the store, there are too many. */
type LiveListener = (event: ServerEvent) => void
const liveListeners = new Set<LiveListener>()

export function onLive(listener: LiveListener): () => void {
  liveListeners.add(listener)
  return () => liveListeners.delete(listener)
}

export function dispatchLive(event: ServerEvent): void {
  liveListeners.forEach((listener) => listener(event))
}
