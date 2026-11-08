/**
 * A Klipy GIF as someone's avatar or banner (block 3.22B, ADR 0044). Klipy's terms forbid keeping
 * copies, so the media loads straight from Klipy's URL, untouched, and the crop is applied here
 * with the same layout as the crop editor's previews. If it doesn't load (gone from Klipy), the
 * caller shows the default instead.
 */

import { useState, type ReactNode } from 'react'

import type { ProfileGif } from '../lib/api'
import { layoutOf, viewOf, type Size } from '../lib/crop'

/** The GIF's media inside a box of `frame` size (the parent clips it: relative + overflow-hidden). */
export function CroppedGif({ gif, frame, onError }: { gif: ProfileGif; frame: Size; onError?: () => void }): ReactNode {
  const image = { width: gif.width, height: gif.height }
  const view = viewOf(gif.crop, image, frame)
  const { left, top, box, img } = layoutOf(view, image, frame)
  const style = { ...img, transform: `translate(-50%, -50%) rotate(${view.rotate}deg)` }
  const className = 'absolute left-1/2 top-1/2 max-w-none select-none'
  return (
    <span aria-hidden className="pointer-events-none absolute" style={{ left, top, ...box }} data-profile-gif={gif.id}>
      {gif.format === 'mp4' ? (
        <video src={gif.url} poster={gif.preview ?? undefined} muted loop autoPlay playsInline className={className} style={style} onError={onError} />
      ) : (
        <img src={gif.url} alt="" draggable={false} className={className} style={style} onError={onError} />
      )}
    </span>
  )
}

/** True once the GIF failed to load; starts over when it's another GIF. */
export function useGifFailed(gif: ProfileGif | null | undefined): [boolean, () => void] {
  const [failed, setFailed] = useState<string | null>(null)
  const id = gif ? `${gif.id} ${gif.url}` : null
  return [!!id && failed === id, () => setFailed(id)]
}
