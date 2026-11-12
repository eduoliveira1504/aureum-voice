/** The layer scale (--z-index-* in main.css), for tests that check what stacks over what. */

import css from '../main.css?raw'

export const LAYERS: Record<string, number> = Object.fromEntries(
  Array.from(css.matchAll(/--z-index-([a-z]+):\s*(\d+);/g), ([, name, value]) => [name, Number(value)])
)

/**
 * The layer an element paints in, seen from the shell: the outermost one among itself and its
 * ancestors (a layer inside another only orders things within it).
 */
export function layerOf(el: Element | null): string | null {
  let layer: string | null = null
  for (let node = el; node; node = node.parentElement) {
    const name = Array.from(node.classList).find((c) => c.slice(2) in LAYERS && c.startsWith('z-'))?.slice(2)
    if (name) layer = name
  }
  return layer
}

/** Whether `top` paints over `bottom` when both sit in the shell (not nested in one another). */
export function isAbove(top: Element | null, bottom: Element | null): boolean {
  const a = layerOf(top)
  const b = layerOf(bottom)
  return a !== null && b !== null && LAYERS[a] > LAYERS[b]
}
