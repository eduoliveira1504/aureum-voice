/**
 * Channel order (block 3.5). The order is the server's, one sidebar section at a time: rooms,
 * conversations, addons. Positions are server-wide numbers; a section reorder hands its channels'
 * current positions out again in the new order, so the other sections don't move.
 */

import type { Channel, ChannelType } from './api'

export type Section = Extract<ChannelType, 'voice' | 'text' | 'addon'>

/** What the drag carries: a type per section, so a channel can only land in its own section. */
export const reorderDragType = (section: Section): string => `application/x-aureum-reorder-${section}`

/** The section's channels with `ids` taking the section's positions in that order. */
export function withSectionOrder(channels: Channel[], ids: string[]): Channel[] {
  const slots = channels
    .filter((c) => ids.includes(c.id))
    .map((c) => c.position)
    .sort((a, b) => a - b)
  const position = new Map(ids.map((id, i) => [id, slots[i]]))
  return channels.map((c) => (position.has(c.id) ? { ...c, position: position.get(c.id)! } : c))
}

/** `ids` with `moved` placed before or after `target`. */
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
