import type { ReactNode } from 'react'

import { mediaUrl } from '../lib/api'

const COLS = 16
const ROWS = 5
const SIZE = 40
// Flat accent tints: the mosaic has no gradient, only these steps.
const TINTS = [0, 0.1, 0.18, 0.3, 0.5]

/** Small deterministic generator, so a server always gets the same mosaic. */
function seeded(seed: string): () => number {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

/** The default banner: a mosaic of triangles in the accent color, unique per server. */
export function BannerArt({ seed }: { seed: string }): ReactNode {
  const random = seeded(seed)
  const triangles: ReactNode[] = []
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = col * SIZE
      const y = row * SIZE
      // Each square splits along one diagonal into two triangles.
      const halves =
        random() < 0.5
          ? [`${x},${y} ${x + SIZE},${y} ${x},${y + SIZE}`, `${x + SIZE},${y} ${x + SIZE},${y + SIZE} ${x},${y + SIZE}`]
          : [`${x},${y} ${x + SIZE},${y} ${x + SIZE},${y + SIZE}`, `${x},${y} ${x + SIZE},${y + SIZE} ${x},${y + SIZE}`]
      for (const points of halves) {
        const tint = TINTS[Math.floor(random() * TINTS.length)]
        if (tint) triangles.push(<polygon key={triangles.length} points={points} fill="var(--accent)" fillOpacity={tint} />)
      }
    }
  }
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${COLS * SIZE} ${ROWS * SIZE}`}
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full bg-elevated"
    >
      {triangles}
    </svg>
  )
}

/** A server's banner as a background layer: the uploaded image, or the mosaic. Put it first
 * inside a `relative` box. */
export function ServerBannerLayer({ server }: { server: { id: string; banner_url: string | null } }): ReactNode {
  const banner = mediaUrl(server.banner_url)
  if (!banner) return <BannerArt seed={server.id} />
  return <span aria-hidden style={{ backgroundImage: `url("${banner}")` }} className="pointer-events-none absolute inset-0 bg-cover bg-center" />
}
