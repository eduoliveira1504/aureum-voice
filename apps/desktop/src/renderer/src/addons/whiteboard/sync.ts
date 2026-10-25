/**
 * The whiteboard's sync rules, apart from Excalidraw so they can be tested: which elements to
 * send, which copy of an element wins, and where to look when following someone.
 */

export interface Versioned {
  id: string
  version: number
  versionNonce: number
}

/** Excalidraw's own rule, same as the API's: the higher version wins, then the lower nonce. */
export function wins(incoming: Versioned, current: Versioned | undefined): boolean {
  if (!current) return true
  if (incoming.version !== current.version) return incoming.version > current.version
  return incoming.versionNonce < current.versionNonce
}

/**
 * The elements changed since they were last sent or received, as far as `known` (id -> version)
 * tells. Records them as known, so each change goes out once.
 */
export function takeChanged<T extends Versioned>(elements: readonly T[], known: Map<string, number>): T[] {
  const changed: T[] = []
  for (const element of elements) {
    if ((known.get(element.id) ?? 0) >= element.version) continue
    known.set(element.id, element.version)
    changed.push(element)
  }
  return changed
}

/** Records elements that came from elsewhere, so they aren't sent back. */
export function markKnown(elements: readonly Pick<Versioned, 'id' | 'version'>[], known: Map<string, number>): void {
  for (const element of elements) {
    if ((known.get(element.id) ?? 0) < element.version) known.set(element.id, element.version)
  }
}

/** What someone sees: Excalidraw's scroll and zoom, and the canvas size in pixels. */
export interface Viewport {
  x: number
  y: number
  width: number
  height: number
  zoom: number
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 30

/**
 * Where to scroll (and how far to zoom) to see what `leader` sees, centered, in a canvas of
 * `width` x `height`. A smaller canvas zooms out so nothing the leader sees is cut off.
 */
export function followView(leader: Viewport, width: number, height: number): { scrollX: number; scrollY: number; zoom: number } {
  // In Excalidraw a point on screen is (scene + scroll) * zoom.
  const centerX = leader.width / (2 * leader.zoom) - leader.x
  const centerY = leader.height / (2 * leader.zoom) - leader.y
  const fit = Math.min(width / leader.width, height / leader.height)
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, leader.zoom * fit))
  return { scrollX: width / (2 * zoom) - centerX, scrollY: height / (2 * zoom) - centerY, zoom }
}

/** Excalidraw keeps images as data URLs; the API wants the bytes. (fetch() can't read data:
 * URLs under the app's CSP.) */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',', 2)
  const type = /^data:([^;,]+)/.exec(head)?.[1] ?? 'application/octet-stream'
  if (!head.endsWith(';base64')) return new Blob([decodeURIComponent(body)], { type })
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
