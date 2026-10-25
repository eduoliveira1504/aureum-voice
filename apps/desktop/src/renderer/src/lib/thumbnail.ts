/**
 * Low-res snapshots of our own screen share for the server overview cards. They go through the
 * API WebSocket, not LiveKit, so watching the overview costs no LiveKit bandwidth.
 *
 * The same frame, smaller still, is the blurred preview on the "Assistir" card inside the call
 * (sent to the room as LiveKit data: a few KB every few seconds, and it works in private calls too).
 */

const WIDTH = 320
const HEIGHT = 180
const QUALITY = 0.6
const INTERVAL_MS = 5000 // the server accepts at most one every 4s
const PREVIEW_WIDTH = 160
const PREVIEW_HEIGHT = 90
const PREVIEW_QUALITY = 0.5
const FIRST_DELAY_MS = 1500 // let the capture settle before the first frame

/** Captures a frame of `track` every few seconds and hands it to `send` (and, smaller, to
 * `sendPreview`); returns the stop function. */
export function startThumbnails(
  track: MediaStreamTrack,
  send: (image: string) => void,
  sendPreview?: (image: string) => void
): () => void {
  const video = document.createElement('video')
  video.muted = true
  video.srcObject = new MediaStream([track])
  void video.play().catch(() => {})

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  const preview = document.createElement('canvas')
  preview.width = PREVIEW_WIDTH
  preview.height = PREVIEW_HEIGHT
  const previewCtx = preview.getContext('2d')

  const capture = (): void => {
    if (!ctx || track.readyState !== 'live' || !video.videoWidth) return
    // Fit the frame inside 320x180, letterboxed (part of the image, not UI, hence plain black).
    const scale = Math.min(WIDTH / video.videoWidth, HEIGHT / video.videoHeight)
    const w = video.videoWidth * scale
    const h = video.videoHeight * scale
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    ctx.drawImage(video, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h)
    send(canvas.toDataURL('image/jpeg', QUALITY))
    if (sendPreview && previewCtx) {
      previewCtx.drawImage(canvas, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
      sendPreview(preview.toDataURL('image/jpeg', PREVIEW_QUALITY))
    }
  }

  const first = setTimeout(capture, FIRST_DELAY_MS)
  const timer = setInterval(capture, INTERVAL_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
    video.srcObject = null
  }
}
