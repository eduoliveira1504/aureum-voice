import type { PanelNode, PanelSplit } from './api'

/**
 * Where a server's panels go: a tree of divisions whose leaves are indexes into the layout's
 * `panels`. A leaf's index says nothing about where it sits: panel 0 (the one with the overview)
 * can end up on the right.
 */

export type Edge = 'left' | 'right' | 'top' | 'bottom'
/** Steps from the root to a split: 'a' and 'b' for each side, '' for the root. */
export type TreePath = string

export const MIN_PANEL = { width: 320, height: 240 }
/** The divider between two panels. */
export const PANEL_GAP = 8

export function leaves(node: PanelNode): number[] {
  return typeof node === 'number' ? [node] : [...leaves(node.a), ...leaves(node.b)]
}

/** Panels in a row, sharing the width: how layouts without a tree are read. */
export function rowOf(count: number, split = 0.5): PanelNode {
  if (count <= 1) return 0
  if (count === 2) return { dir: 'row', ratio: split, a: 0, b: 1 }
  const tail = (from: number): PanelNode =>
    from === count - 1 ? from : { dir: 'row', ratio: 1 / (count - from), a: from, b: tail(from + 1) }
  return tail(0)
}

/** Whether a saved tree has each panel exactly once (an older app may have changed the panels). */
export function matches(tree: PanelNode, count: number): boolean {
  const found = leaves(tree)
  return found.length === count && new Set(found).size === count && found.every((i) => i >= 0 && i < count)
}

/** Divides a panel, putting a new one on one of its edges. */
export function splitPanel(node: PanelNode, target: number, edge: Edge, added: number): PanelNode {
  if (typeof node !== 'number') {
    return { ...node, a: splitPanel(node.a, target, edge, added), b: splitPanel(node.b, target, edge, added) }
  }
  if (node !== target) return node
  const first = edge === 'left' || edge === 'top'
  return { dir: edge === 'left' || edge === 'right' ? 'row' : 'col', ratio: 0.5, a: first ? added : node, b: first ? node : added }
}

/** Which edge of a panel a point falls on, if it's near one (x and y from 0 to 1 across it). */
export function dropEdge(x: number, y: number): Edge | null {
  const [edge, distance] = (
    [
      ['left', x],
      ['right', 1 - x],
      ['top', y],
      ['bottom', 1 - y]
    ] as [Edge, number][]
  ).reduce((nearest, next) => (next[1] < nearest[1] ? next : nearest))
  return distance < 0.25 ? edge : null
}

/** Takes a panel out: its neighbor gets the space, and the panels after it move down an index. */
export function removePanel(node: PanelNode, index: number): PanelNode {
  if (typeof node === 'number') return node > index ? node - 1 : node
  if (node.a === index) return removePanel(node.b, index)
  if (node.b === index) return removePanel(node.a, index)
  return { ...node, a: removePanel(node.a, index), b: removePanel(node.b, index) }
}

export function setRatio(node: PanelNode, path: TreePath, ratio: number): PanelNode {
  if (typeof node === 'number') return node
  if (!path) return { ...node, ratio }
  const side = path[0] as 'a' | 'b'
  return { ...node, [side]: setRatio(node[side], path.slice(1), ratio) }
}

export function nodeAt(node: PanelNode, path: TreePath): PanelNode | undefined {
  if (!path) return node
  return typeof node === 'number' ? undefined : nodeAt(node[path[0] as 'a' | 'b'], path.slice(1))
}

/** How many panels a node needs side by side in a direction. */
function span(node: PanelNode, dir: PanelSplit['dir']): number {
  if (typeof node === 'number') return 1
  const a = span(node.a, dir)
  const b = span(node.b, dir)
  return node.dir === dir ? a + b : Math.max(a, b)
}

/** The ratio that gives each panel along the split the same size. */
export function evenRatio(split: PanelSplit): number {
  const a = span(split.a, split.dir)
  return a / (a + span(split.b, split.dir))
}

const minLength = (dir: PanelSplit['dir']): number => (dir === 'row' ? MIN_PANEL.width : MIN_PANEL.height)

/** The smallest a node can be in a direction. */
export function minSize(node: PanelNode, dir: PanelSplit['dir']): number {
  const count = span(node, dir)
  return count * minLength(dir) + (count - 1) * PANEL_GAP
}

/** Takes a leaf out without touching the indexes; returns the tree and the neighbor that gets it. */
function foldLeaf(node: PanelSplit, leaf: number): { tree: PanelNode; host: number } {
  if (node.b === leaf) return { tree: node.a, host: leaves(node.a).at(-1) as number }
  if (node.a === leaf) return { tree: node.b, host: leaves(node.b)[0] }
  const side = leaves(node.a).includes(leaf) ? 'a' : 'b'
  const { tree, host } = foldLeaf(node[side] as PanelSplit, leaf)
  return { tree: { ...node, [side]: tree }, host }
}

/** The last panel in a division of this direction: folding it frees room along that direction. */
function lastAlong(node: PanelNode, dir: PanelSplit['dir']): number | null {
  if (typeof node === 'number') return null
  return lastAlong(node.b, dir) ?? lastAlong(node.a, dir) ?? (node.dir === dir ? (leaves(node.b).at(-1) as number) : null)
}

/**
 * What fits in a size: panels that don't become tabs of a neighbor, last ones first. Nothing here
 * is saved, so they go back to their places when the window grows. `folded` lists, per panel left
 * on screen, the panels whose tabs it shows.
 */
export function fitPanels(tree: PanelNode, width: number, height: number): { tree: PanelNode; folded: Record<number, number[]> } {
  const folded: Record<number, number[]> = {}
  let node = tree
  while (typeof node !== 'number' && (minSize(node, 'row') > width || minSize(node, 'col') > height)) {
    const leaf = lastAlong(node, minSize(node, 'row') > width ? 'row' : 'col') as number
    const { tree: rest, host } = foldLeaf(node, leaf)
    folded[host] = [...(folded[host] ?? []), leaf, ...(folded[leaf] ?? [])]
    delete folded[leaf]
    node = rest
  }
  return { tree: node, folded }
}

/** Keeps a dragged divider from squeezing either side below its minimum. */
export function clampRatio(split: PanelSplit, ratio: number, size: number): number {
  const low = Math.max(0.1, minSize(split.a, split.dir) / size)
  const high = Math.min(0.9, 1 - minSize(split.b, split.dir) / size)
  return low > high ? 0.5 : Math.min(high, Math.max(low, ratio))
}
