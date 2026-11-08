import { RemoteVideoTrack, type ElementInfo, type Track } from 'livekit-client'
import { useEffect, useRef, type ReactNode } from 'react'

/**
 * A video in a window of its own (the overlay, the detached call window). Remote tracks are
 * registered with LiveKit's adaptive stream as a picture-in-picture element: while that window is
 * showing, the video keeps flowing (at the size it's drawn at, so a small window gets the low layer)
 * even though the app's own window may be minimized or behind a game and would otherwise pause it.
 */
export function PopupVideo({ track, mirror }: { track: Track; mirror: boolean }): ReactNode {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = new MediaStream([track.mediaStreamTrack])
    void el.play().catch(() => {})
    if (!(track instanceof RemoteVideoTrack) || !track.isAdaptiveStream) return
    const doc = el.ownerDocument
    const shown = (): boolean => doc.visibilityState === 'visible'
    const info: ElementInfo = {
      element: el,
      width: () => el.clientWidth,
      height: () => el.clientHeight,
      get visible() {
        return shown()
      },
      get pictureInPicture() {
        return shown()
      },
      visibilityChangedAt: Date.now(),
      observe: () => doc.addEventListener('visibilitychange', onVisibility),
      stopObserving: () => doc.removeEventListener('visibilitychange', onVisibility)
    }
    function onVisibility(): void {
      info.visibilityChangedAt = Date.now()
      info.handleVisibilityChanged?.()
    }
    track.observeElementInfo(info)
    return () => {
      track.stopObservingElementInfo(info)
      el.srcObject = null
    }
  }, [track, track.mediaStreamTrack])
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className="h-full w-full object-contain"
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
    />
  )
}
