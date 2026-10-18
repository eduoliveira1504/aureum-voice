import { LucideProvider, HeadphoneOff, MicOff, MoveDiagonal2 } from 'lucide-react'
import { RemoteVideoTrack, type ElementInfo, type Track } from 'livekit-client'
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import type { Me } from '../lib/api'
import type { OverlayBounds, OverlaySize } from '../../../shared/types'
import { useOverlay } from '../store/overlay'
import { cameraTrackOf, roomIdentities, useVoice } from '../store/voice'
import { useCallContext } from './CallCard'
import { Avatar } from './ui'

/** Prefix of the popup's name; the main process lets only `aureum-overlay-<n>` through (isOverlayFrame). */
const FRAME_NAME = 'aureum-overlay'
const SCALE: Record<OverlaySize, number> = { small: 0.8, medium: 1, large: 1.3 }
/** "Only who's speaking" keeps a person up this long after they stop, so pauses don't flicker. */
const SPEAKING_HOLD_MS = 1500

/**
 * Opens the in-game overlay window while it has something to show, and renders into it.
 *
 * It's a popup of this window (window.open), so it lives in this same process: it reads the
 * same stores and plays the call's video tracks directly, without a second LiveKit connection
 * (which would count twice against the media quota). The main process owns the window itself
 * (always on top, click-through, hidden while this app is focused).
 */
export function OverlayHost({ me }: { me: Me }): ReactNode {
  const state = useOverlay((s) => s.state)
  const phase = useVoice((s) => s.phase)
  const inCall = phase === 'connected' || phase === 'reconnecting'
  const editing = state?.editing ?? false
  const wanted = !!state?.prefs.enabled && (inCall || editing)
  const [popup, setPopup] = useState<Window | null>(null)
  // Bumped when the window is closed from outside, to open a new one if it's still wanted.
  const [reopen, setReopen] = useState(0)

  useEffect(() => {
    void window.aureum.overlay.setActive(inCall)
  }, [inCall])
  useEffect(() => () => void window.aureum.overlay.setActive(false), [])

  useEffect(() => {
    if (!wanted) return
    // A unique name, so a window still closing is never reused.
    const child = window.open('about:blank', `${FRAME_NAME}-${Date.now()}`)
    if (!child) return
    const stopSync = prepareDocument(child.document)
    setPopup(child)
    // Closed from outside (Alt+F4 in edit mode): forget it; it reopens if still wanted.
    const onGone = (): void => {
      stopSync()
      setPopup((p) => (p === child ? null : p))
      setReopen((n) => n + 1)
    }
    child.addEventListener('pagehide', onGone)
    return () => {
      child.removeEventListener('pagehide', onGone)
      stopSync()
      child.close()
      setPopup((p) => (p === child ? null : p))
    }
  }, [wanted, reopen])

  if (!popup || !state) return null
  return createPortal(
    <LucideProvider strokeWidth={1.8}>
      <OverlayView me={me} popup={popup} editing={editing} />
    </LucideProvider>,
    popup.document.body
  )
}

/** Gives the blank popup the app's styles and theme, and keeps them in sync. */
function prepareDocument(doc: Document): () => void {
  doc.title = 'Aureum Voice — overlay'
  const base = doc.createElement('style')
  base.textContent = 'html, body { background: transparent !important; overflow: hidden; height: 100%; margin: 0; }'

  const syncStyles = (): void => {
    const copies = [...document.head.querySelectorAll<HTMLElement>('style, link[rel="stylesheet"]')].map((node) => {
      const copy = node.cloneNode(true) as HTMLElement
      // Relative URLs would resolve against about:blank.
      if (copy instanceof HTMLLinkElement) copy.href = (node as HTMLLinkElement).href
      return copy
    })
    doc.head.replaceChildren(...copies, base)
  }
  const syncTheme = (): void => {
    for (const { name } of [...doc.documentElement.attributes]) doc.documentElement.removeAttribute(name)
    for (const { name, value } of document.documentElement.attributes) doc.documentElement.setAttribute(name, value)
  }
  syncStyles()
  syncTheme()
  // Theme/accent changes, and stylesheets swapped by hot reload in development.
  const themeObserver = new MutationObserver(syncTheme)
  themeObserver.observe(document.documentElement, { attributes: true })
  const styleObserver = new MutationObserver(syncStyles)
  styleObserver.observe(document.head, { childList: true, subtree: true, characterData: true })
  return () => {
    themeObserver.disconnect()
    styleObserver.disconnect()
  }
}

interface Person {
  id: string
  name: string
  avatarUrl: string | null | undefined
  speaking: boolean
  muted: boolean
  deafened: boolean
  camera: Track | undefined
}

/** People to show: everyone in the call, or a sample while placing the overlay outside a call. */
function usePeople(me: Me, onlySpeaking: boolean, showCameras: boolean): { people: Person[]; preview: boolean } {
  useVoice((s) => s.version) // re-read the room on participant/track changes
  const speaking = useVoice((s) => s.speaking)
  const ownMuted = useVoice((s) => s.muted || !s.allowed.mic)
  const ownDeafened = useVoice((s) => s.deafened || s.serverDeafened)
  const info = useCallContext(me.id)
  const lastSpoke = useRef(new Map<string, number>())
  const [, setTick] = useState(0)

  const now = Date.now()
  for (const id of speaking) lastSpoke.current.set(id, now)
  const recentlySpoke = (id: string): boolean => now - (lastSpoke.current.get(id) ?? 0) < SPEAKING_HOLD_MS

  // Re-render when the next held speaker should drop off.
  const nextDrop = onlySpeaking
    ? Math.min(...[...lastSpoke.current.values()].map((t) => t + SPEAKING_HOLD_MS).filter((t) => t > now))
    : Infinity
  useEffect(() => {
    if (!Number.isFinite(nextDrop)) return
    const timer = setTimeout(() => setTick((t) => t + 1), nextDrop - Date.now() + 20)
    return () => clearTimeout(timer)
  }, [nextDrop])

  if (!info) {
    return {
      preview: true,
      people: [
        { id: me.id, name: me.display_name, avatarUrl: me.avatar_url, speaking: true, muted: false, deafened: false, camera: undefined },
        { id: 'preview', name: 'Exemplo', avatarUrl: null, speaking: false, muted: true, deafened: false, camera: undefined }
      ]
    }
  }

  const people = roomIdentities().map((id): Person => {
    const isMe = id === me.id
    const voice = info.present.find((v) => v.user_id === id)
    const user = isMe ? me : info.people.get(id)
    return {
      id,
      name: user?.display_name ?? 'Alguém',
      avatarUrl: user?.avatar_url,
      speaking: speaking.includes(id),
      muted: isMe ? ownMuted : !!(voice?.muted || voice?.server_muted),
      deafened: isMe ? ownDeafened : !!voice?.deafened,
      camera: showCameras ? cameraTrackOf(id) : undefined
    }
  })
  return { preview: false, people: onlySpeaking ? people.filter((p) => p.speaking || recentlySpoke(p.id)) : people }
}

/** Which screen corner the box is nearest to: content hugs that side, so it grows away from it. */
function anchorOf(popup: Window): { right: boolean; bottom: boolean } {
  const s = popup.screen as Screen & { availLeft: number; availTop: number }
  return {
    right: popup.screenX + popup.outerWidth / 2 > s.availLeft + s.availWidth / 2,
    bottom: popup.screenY + popup.outerHeight / 2 > s.availTop + s.availHeight / 2
  }
}

function OverlayView({ me, popup, editing }: { me: Me; popup: Window; editing: boolean }): ReactNode {
  const prefs = useOverlay((s) => s.state!.prefs)
  const { people, preview } = usePeople(me, prefs.onlySpeaking, prefs.showCameras)
  const [, setMoved] = useState(0)
  const scale = SCALE[prefs.size]
  const anchor = anchorOf(popup)

  // Esc / Enter end edit mode (the overlay has the focus while editing).
  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter') void window.aureum.overlay.setEditing(false)
    }
    popup.addEventListener('keydown', onKey)
    return () => popup.removeEventListener('keydown', onKey)
  }, [editing, popup])

  /** Moves (or, from the corner handle, resizes) the window with the pointer. */
  const dragWith =
    (mode: 'move' | 'resize') =>
    (e: PointerEvent<HTMLElement>): void => {
      if (!editing || (mode === 'move' && (e.target as HTMLElement).closest('button, [data-handle]'))) return
      e.preventDefault()
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      const start = { x: popup.screenX, y: popup.screenY, width: popup.outerWidth, height: popup.outerHeight }
      const from = { x: e.screenX, y: e.screenY }
      let frame = 0
      let latest: OverlayBounds = start
      const move = (ev: globalThis.PointerEvent): void => {
        const dx = ev.screenX - from.x
        const dy = ev.screenY - from.y
        latest =
          mode === 'move'
            ? { ...start, x: start.x + dx, y: start.y + dy }
            : { ...start, width: start.width + dx, height: start.height + dy }
        // One IPC call per frame at most.
        if (!frame) {
          frame = popup.requestAnimationFrame(() => {
            frame = 0
            void window.aureum.overlay.setBounds(latest)
          })
        }
      }
      const up = (): void => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
        if (frame) popup.cancelAnimationFrame(frame)
        void window.aureum.overlay.setBounds(latest).then(() => setMoved((n) => n + 1))
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
    }

  return (
    <div
      onPointerDown={dragWith('move')}
      className={`relative flex h-full w-full touch-none select-none flex-col gap-1.5 overflow-hidden p-2 ${
        anchor.right ? 'items-end' : 'items-start'
      } ${anchor.bottom ? 'justify-end' : 'justify-start'} ${
        editing ? 'cursor-move rounded-panel border-2 border-dashed border-accent bg-scrim/50' : ''
      }`}
      style={{ fontSize: 14 * scale }}
    >
      {editing && (
        <div className="pointer-events-auto absolute inset-x-2 top-2 z-10 flex items-center gap-2 rounded-control bg-panel/95 px-2.5 py-1.5 text-xs text-fg shadow-lg">
          <span className="min-w-0 flex-1 truncate">
            {preview ? 'Prévia · ' : ''}Arraste para mover · Esc para concluir
          </span>
          <button
            type="button"
            onClick={() => void window.aureum.overlay.setEditing(false)}
            className="shrink-0 rounded-item bg-accent px-2 py-0.5 font-semibold text-on-accent"
          >
            Concluir
          </button>
        </div>
      )}

      <div className={`flex flex-col gap-1.5 ${anchor.right ? 'items-end' : 'items-start'}`} style={{ opacity: prefs.opacity / 100 }}>
        {people.map((p) => (p.camera ? <CameraCard key={p.id} person={p} mirror={p.id === me.id} scale={scale} /> : <PersonRow key={p.id} person={p} scale={scale} />))}
      </div>

      {editing && (
        <span
          data-handle
          title="Redimensionar"
          onPointerDown={dragWith('resize')}
          className="absolute bottom-1 right-1 z-10 cursor-nwse-resize rounded-item bg-panel/95 p-1 text-fg-muted"
        >
          <MoveDiagonal2 size={14} />
        </span>
      )}
    </div>
  )
}

function StateIcons({ person }: { person: Person }): ReactNode {
  return (
    <>
      {person.muted && <MicOff size="1.1em" className="shrink-0 text-danger" aria-label="Microfone desligado" />}
      {person.deafened && <HeadphoneOff size="1.1em" className="shrink-0 text-danger" aria-label="Áudio desligado" />}
    </>
  )
}

function PersonRow({ person, scale }: { person: Person; scale: number }): ReactNode {
  return (
    <div className="flex max-w-full items-center gap-[0.5em] rounded-full bg-scrim/75 py-[0.25em] pl-[0.25em] pr-[0.85em] text-on-scrim shadow">
      <span className={`shrink-0 rounded-full ${person.speaking ? 'ring-[3px] ring-accent' : 'ring-[3px] ring-transparent'}`}>
        <Avatar name={person.name} url={person.avatarUrl} size={Math.round(30 * scale)} />
      </span>
      <span className="min-w-0 truncate font-semibold">{person.name}</span>
      <StateIcons person={person} />
    </div>
  )
}

function CameraCard({ person, mirror, scale }: { person: Person; mirror: boolean; scale: number }): ReactNode {
  return (
    <div
      className={`relative aspect-video shrink-0 overflow-hidden rounded-control bg-scrim shadow ${
        person.speaking ? 'ring-[3px] ring-accent' : ''
      }`}
      style={{ width: 176 * scale }}
    >
      <OverlayVideo track={person.camera!} mirror={mirror} />
      <span className="absolute bottom-1 left-1 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded-item bg-scrim/70 px-1.5 text-[0.8em] text-on-scrim">
        <span className="truncate">{person.name}</span>
        <StateIcons person={person} />
      </span>
    </div>
  )
}

/**
 * A camera in the overlay. Remote tracks are registered with LiveKit's adaptive stream as a
 * picture-in-picture element: while the overlay is showing, the video keeps flowing (at the
 * small size it's drawn at) even though the app's own window is behind the game and would
 * otherwise pause it.
 */
function OverlayVideo({ track, mirror }: { track: Track; mirror: boolean }): ReactNode {
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
      className="h-full w-full object-cover"
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
    />
  )
}
