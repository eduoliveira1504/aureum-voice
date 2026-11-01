/**
 * Channel order (blocks 3.5 and 3.12). The order is the server's: categories have their own, and
 * inside each one the channels follow their position, of any type. Positions are server-wide
 * numbers; arranging a category hands the channels' current positions out again in the new order,
 * so nothing else moves.
 */

import type { Category, Channel, ServerDetail } from './api'

/** What a drag carries: a channel going to a place in a list, or a category. */
export const CHANNEL_DRAG_TYPE = 'application/x-aureum-reorder-channel'
export const CATEGORY_DRAG_TYPE = 'application/x-aureum-reorder-category'

type Layout = Pick<ServerDetail, 'channels'> & { categories?: Category[] }

export interface ChannelGroups {
  /** Without a category: at the top. */
  loose: Channel[]
  groups: { category: Category; channels: Channel[] }[]
}

const byPosition = <T extends { position: number }>(a: T, b: T): number => a.position - b.position

/** The sidebar's structure. A channel whose category isn't known counts as having none. */
export function channelGroups(server: Layout): ChannelGroups {
  const categories = [...(server.categories ?? [])].sort(byPosition)
  const known = new Set(categories.map((c) => c.id))
  const channels = [...server.channels].sort(byPosition)
  return {
    loose: channels.filter((c) => !c.category_id || !known.has(c.category_id)),
    groups: categories.map((category) => ({ category, channels: channels.filter((c) => c.category_id === category.id) }))
  }
}

/** Every channel in the order people see them: for lists outside the sidebar. */
export function orderedChannels(server: Layout): Channel[] {
  const { loose, groups } = channelGroups(server)
  return [...loose, ...groups.flatMap((g) => g.channels)]
}

/** Where a new channel of this type goes unless the person picks: next to the others of its type. */
export function defaultCategory(server: Layout | undefined, type: Channel['type']): string {
  const found = server && channelGroups(server).groups.find((g) => g.channels.some((c) => c.type === type))
  return found?.category.id ?? ''
}

/** The channels in `ids` in `categoryId`, taking each other's positions in that order. */
export function withArrangement(channels: Channel[], categoryId: string | null, ids: string[]): Channel[] {
  const slots = channels
    .filter((c) => ids.includes(c.id))
    .map((c) => c.position)
    .sort((a, b) => a - b)
  const position = new Map(ids.map((id, i) => [id, slots[i]]))
  return channels.map((c) => (position.has(c.id) ? { ...c, position: position.get(c.id)!, category_id: categoryId } : c))
}

/** `ids` with `moved` placed before or after `target`; `moved` may come from another list. */
export function moveId(ids: string[], moved: string, target: string, after: boolean): string[] {
  if (moved === target) return ids
  const rest = ids.filter((id) => id !== moved)
  const at = rest.indexOf(target) + (after ? 1 : 0)
  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}

/** `ids` with `moved` one place up (-1) or down (+1); unchanged at the edges. */
export function stepId(ids: string[], moved: string, delta: -1 | 1): string[] {
  const i = ids.indexOf(moved)
  const j = i + delta
  if (i < 0 || j < 0 || j >= ids.length) return ids
  const next = [...ids]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}
