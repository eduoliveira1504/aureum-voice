# 0004 — Call layout and bandwidth

- **Status:** accepted
- **Date:** 2026-10-16

## Context

While the media server is LiveKit Cloud's free plan, download bandwidth is a hard monthly cap
(about 50 GB). A call with several cameras and two live screens would burn through it quickly if
every viewer received every video at full resolution. Phase 2 also adds a Focus layout (one big
tile plus a side strip) next to the Grid.

## Decision

- **Every video is simulcast.** Cameras publish 180p and 360p layers below 720p. Screen shares
  publish 360p and 720p layers below 1080p (15/30 fps for "motion", 3/15 fps for "detail").
- **`adaptiveStream` chooses the layer, not app code.** LiveKit watches each `<video>` element
  (ResizeObserver + IntersectionObserver) and subscribes to the layer that fits its size; elements
  that are hidden or scrolled out of the side strip are paused. We don't call `setVideoQuality`,
  which `adaptiveStream` would override anyway.
- **`dynacast`** stops publishers from encoding layers that no one is receiving.
- **Tiles**: one per person (camera or avatar) and one per shared screen, so several screens can be
  live at once. Clicking a tile pins it in Focus. Without a pin, Focus shows someone else's screen,
  else someone else; the user's own screen is never auto-focused.

## Measured (two clients, local LiveKit, 1400×860 window)

| Tile                  | Element size | Received   |
| --------------------- | ------------ | ---------- |
| Camera in side strip  | 220×124      | 320×180    |
| Camera in grid        | 394×222      | 640×360    |
| Camera in focus       | 564×685      | 1280×720   |
| Screen in side strip  | 220×124      | 640×360    |
| Screen in focus       | 564×685      | 1280×720   |

## Consequences

- Watching one screen in focus with others in the strip costs roughly one high layer plus a few
  low ones, instead of every stream at full size.
- Layer selection depends on rendered size, so UI that shows video must render it at its real size
  (no hidden full-size `<video>` elements).
