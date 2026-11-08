/**
 * Tells drags that started inside the app (an image, a tab, a channel) from files brought in from
 * outside (Explorer, the desktop). Chromium puts "Files" on the drag of a page's own <img>, so the
 * data alone can't tell them apart: a drag from outside never fires dragstart in this window.
 */

let internal = false

const start = (): void => {
  internal = true
}
const end = (): void => {
  internal = false
}

if (typeof window !== 'undefined') {
  window.addEventListener('dragstart', start, true)
  // dragend reaches the source after the drop; the drop itself clears it too (after the drop
  // targets, in the bubble phase) in case the source left the page mid-drag and never got one.
  window.addEventListener('dragend', end, true)
  window.addEventListener('drop', () => setTimeout(end))
}

/** Whether the drag in progress started inside the app. */
export const isInternalDrag = (): boolean => internal
