import { create } from 'zustand'

import { api } from '../../lib/api'

export type Stage = 'todo' | 'doing' | 'done'
/** Names of the --label-<color> tokens. */
export type LabelColor = 'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink'

export const LABEL_COLORS: LabelColor[] = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink']
export const STAGE_LABEL: Record<Stage, string> = { todo: 'A fazer', doing: 'Fazendo', done: 'Feito' }

export interface KanbanColumn {
  id: string
  name: string
  stage: Stage
  position: number
}

export interface KanbanLabel {
  id: string
  name: string
  color: LabelColor
}

export interface KanbanCard {
  id: string
  column_id: string
  title: string
  description: string
  assignee_id: string | null
  label_ids: string[]
  /** YYYY-MM-DD. */
  due_date: string | null
  position: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Board {
  columns: KanbanColumn[]
  labels: KanbanLabel[]
  cards: KanbanCard[]
  can_edit: boolean
  can_manage: boolean
}

export interface HistoryEntry {
  id: number
  card_id: string | null
  actor_id: string | null
  action: string
  data: Record<string, unknown>
  created_at: string
}

export type CardFields = Partial<Pick<KanbanCard, 'title' | 'description' | 'assignee_id' | 'label_ids' | 'due_date'>>

export const boardPath = (channelId: string, path = ''): string => `/addons/kanban/channels/${channelId}${path}`

const byPosition = <T extends { position: number }>(a: T, b: T): number => a.position - b.position

/** The column's cards in order. */
export function columnCards(board: Board, columnId: string): KanbanCard[] {
  return board.cards.filter((c) => c.column_id === columnId).sort(byPosition)
}

/** Puts a card at `position` in a column the way the API does, renumbering both columns. */
function placeCard(board: Board, cardId: string, columnId: string, position: number): Board {
  const card = board.cards.find((c) => c.id === cardId)
  if (!card) return board
  const target = columnCards(board, columnId).filter((c) => c.id !== cardId)
  target.splice(Math.min(position, target.length), 0, { ...card, column_id: columnId })
  const moved = new Map(target.map((c, i) => [c.id, { ...c, position: i }]))
  if (card.column_id !== columnId) {
    columnCards(board, card.column_id)
      .filter((c) => c.id !== cardId)
      .forEach((c, i) => moved.set(c.id, { ...c, position: i }))
  }
  return { ...board, cards: board.cards.map((c) => moved.get(c.id) ?? c) }
}

const upsert = <T extends { id: string }>(items: T[], item: T): T[] => [...items.filter((i) => i.id !== item.id), item]

interface KanbanState {
  /** By channel id. */
  boards: Record<string, Board>
  load(channelId: string): Promise<void>
  patch(channelId: string, change: (board: Board) => Board): void
  /** Applies an `addon.kanban.*` event. */
  apply(type: string, data: Record<string, unknown>): void

  createCard(channelId: string, columnId: string, title: string): Promise<KanbanCard>
  updateCard(channelId: string, cardId: string, fields: CardFields): Promise<void>
  /** Moves right away on screen, then on the server (reloading if it refuses). */
  moveCard(channelId: string, cardId: string, columnId: string, position: number): Promise<void>
  deleteCard(channelId: string, cardId: string): Promise<void>
}

export const useKanban = create<KanbanState>()((set, get) => ({
  boards: {},

  load: async (channelId) => {
    const board = await api<Board>(boardPath(channelId))
    set((s) => ({ boards: { ...s.boards, [channelId]: board } }))
  },

  patch: (channelId, change) =>
    set((s) => {
      const board = s.boards[channelId]
      return board ? { boards: { ...s.boards, [channelId]: change(board) } } : s
    }),

  apply: (type, data) => {
    const channelId = data.channel_id as string
    const event = type.slice('addon.kanban.'.length)
    get().patch(channelId, (b) => {
      switch (event) {
        case 'card.created':
        case 'card.updated':
          return { ...b, cards: upsert(b.cards, data as unknown as KanbanCard) }
        case 'card.deleted':
          return { ...b, cards: b.cards.filter((c) => c.id !== data.id) }
        case 'cards.moved': {
          const moved = new Map((data.cards as Pick<KanbanCard, 'id' | 'column_id' | 'position'>[]).map((c) => [c.id, c]))
          return { ...b, cards: b.cards.map((c) => ({ ...c, ...moved.get(c.id) })) }
        }
        case 'column.created':
        case 'column.updated':
          return { ...b, columns: upsert(b.columns, data as unknown as KanbanColumn).sort(byPosition) }
        case 'columns.moved':
          return { ...b, columns: (data.columns as KanbanColumn[]).slice().sort(byPosition) }
        case 'column.deleted':
          return { ...b, columns: b.columns.filter((c) => c.id !== data.id) }
        case 'label.created':
        case 'label.updated':
          return { ...b, labels: upsert(b.labels, data as unknown as KanbanLabel).sort((x, y) => x.name.localeCompare(y.name)) }
        case 'label.deleted':
          return {
            ...b,
            labels: b.labels.filter((l) => l.id !== data.id),
            cards: b.cards.map((c) => (c.label_ids.includes(data.id as string) ? { ...c, label_ids: c.label_ids.filter((id) => id !== data.id) } : c))
          }
        default:
          return b
      }
    })
  },

  createCard: async (channelId, columnId, title) => {
    const card = await api<KanbanCard>(boardPath(channelId, '/cards'), { method: 'POST', body: { column_id: columnId, title } })
    get().patch(channelId, (b) => ({ ...b, cards: upsert(b.cards, card) }))
    return card
  },

  updateCard: async (channelId, cardId, fields) => {
    const card = await api<KanbanCard>(boardPath(channelId, `/cards/${cardId}`), { method: 'PATCH', body: fields })
    get().patch(channelId, (b) => ({ ...b, cards: upsert(b.cards, card) }))
  },

  moveCard: async (channelId, cardId, columnId, position) => {
    get().patch(channelId, (b) => placeCard(b, cardId, columnId, position))
    try {
      await api(boardPath(channelId, `/cards/${cardId}/move`), { method: 'POST', body: { column_id: columnId, position } })
    } catch (err) {
      await get().load(channelId).catch(() => {})
      throw err
    }
  },

  deleteCard: async (channelId, cardId) => {
    await api(boardPath(channelId, `/cards/${cardId}`), { method: 'DELETE' })
    get().patch(channelId, (b) => ({ ...b, cards: b.cards.filter((c) => c.id !== cardId) }))
  }
}))
