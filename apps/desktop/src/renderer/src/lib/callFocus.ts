/**
 * Who a call shows big (block 4.2.9): the same choice for the floating window and the detached one.
 * Tile keys are `<identity>:person` or `<identity>:screen`, as on the call screen.
 */

/** One box on a call: a person (camera or avatar) or a shared screen. */
export interface Tile {
  key: string
  identity: string
  kind: 'person' | 'screen'
}

export interface FocusInput {
  /** The tile someone pinned in this call (here or on the call screen), if any. */
  pinned: string | null
  meId: string
  /** Who is speaking right now. */
  speaking: string[]
  /** What was shown big a moment ago: kept when nothing else asks for the place. */
  previous: string | null
}

/**
 * In order: the pinned tile; someone else's shared screen; in a 1 to 1 call, the other person; in a
 * group, whoever else is speaking, else whoever was shown (so the window doesn't jump between
 * sentences, or when someone joins or leaves), else someone else. Alone, yourself.
 */
export function pickFocus(tiles: Tile[], { pinned, meId, speaking, previous }: FocusInput): Tile | undefined {
  const pin = pinned ? tiles.find((t) => t.key === pinned) : undefined
  if (pin) return pin
  const screen = tiles.find((t) => t.kind === 'screen' && t.identity !== meId)
  if (screen) return screen
  const others = tiles.filter((t) => t.kind === 'person' && t.identity !== meId)
  if (others.length === 0) return tiles.find((t) => t.kind === 'person') ?? tiles[0]
  if (others.length === 1) return others[0]
  const talking = others.find((t) => speaking.includes(t.identity))
  if (talking) return talking
  return others.find((t) => t.key === previous) ?? others[0]
}

/** The tiles besides the big one, and how many of them don't fit in `max` thumbnails. */
export function thumbnails(tiles: Tile[], focused: Tile | undefined, max: number): { shown: Tile[]; more: number } {
  const rest = tiles.filter((t) => t.key !== focused?.key)
  return { shown: rest.slice(0, max), more: Math.max(0, rest.length - max) }
}
