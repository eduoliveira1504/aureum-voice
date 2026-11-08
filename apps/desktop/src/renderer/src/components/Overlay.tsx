import { LucideProvider, MoveDiagonal2 } from 'lucide-react'
import { RemoteVideoTrack, type ElementInfo, type Track } from 'livekit-client'
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import type { Me } from '../lib/api'
import { cameraLayout, DEFAULT_WIDGETS, splitPeople, visibleCameras } from '../../../shared/overlayWidgets'
import type { OverlayBounds, OverlayCameraPrefs, OverlayWidget, OverlayWidgets } from '../../../shared/types'
import { callChanges, notifyOverlay, setOverlayPrefs, useOverlay, type OverlayNotification } from '../store/overlay'
import { useSocial } from '../store/social'
import { cameraTrackOf, roomIdentities, useVoice } from '../store/voice'
import { useCallContext } from './CallCard'
import { CameraEditBar, tileWidthAfterDrag } from './OverlayCameras'
import { CameraCard, CameraTiles, NotificationCard, PersonRow, SCALE, type Person } from './OverlayWidgets'

/** Prefix of a widget window's name; the main process lets only `aureum-overlay-<widget>-<n>` through (widgetOfFrame). */
const FRAME_NAME = 'aureum-overlay'
/** "Only who's speaking" keeps a person up this long after they stop, so pauses don't flicker. */
const SPEAKING_HOLD_MS = 1500

/** Opens a widget's window while it has something to show; null while it's closed. */
function useWidgetWindow(widget: OverlayWidget, wanted: boolean): Window | null {
  const [popup, setPopup] = useState<Window | null>(null)
  // Bumped when the window is closed from outside, to open a new one if it's still wanted.
  const [reopen, setReopen] = useState(0)

  useEffect(() => {
    if (!wanted) return
    // A unique name, so a window still closing is never reused.
    const child = window.open('about:blank', `${FRAME_NAME}-${widget}-${Date.now()}`)
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
  }, [widget, wanted, reopen])

  return popup
}

/**
 * Opens the in-game overlay's widgets, one window each, and renders into them.
 *
 * They're popups of this window (window.open), so they live in this same process: they read the
 * same stores and play the call's video tracks directly, without a second LiveKit connection
 * (which would count twice against the media quota). The main process owns the windows themselves
 * (always on top, click-through, hidden while this app is focused).
 */
export function OverlayHost({ me }: { me: Me }): ReactNode {
  const state = useOverlay((s) => s.state)
  const phase = useVoice((s) => s.phase)
  const inCall = phase === 'connected' || phase === 'reconnecting'
  const editing = state?.editing ?? false
  const notice = state?.notice ?? null
  const ask = state?.ask ?? null
  const enabled = !!state?.prefs.enabled
  const widgets = state?.prefs.widgets ?? DEFAULT_WIDGETS
  const { voice, cameras, preview } = usePeople(me, editing, widgets)
  const notifications = useOverlay((s) => s.notifications)
  const notifying = notifications.length > 0
  useCallNotifications(me)

  useEffect(() => {
    void window.aureum.overlay.setActive(inCall)
  }, [inCall])
  useEffect(() => () => void window.aureum.overlay.setActive(false), [])
  useEffect(() => {
    void window.aureum.overlay.setNotifying(notifying)
  }, [notifying])

  // The voice window also carries the shortcut's messages and the question, with the widget off too.
  const voicePopup = useWidgetWindow('voice', enabled && ((widgets.voice.enabled && (inCall || editing)) || notice !== null || ask !== null))
  // Only while someone has a camera on.
  const camerasPopup = useWidgetWindow('cameras', enabled && widgets.cameras.enabled && (cameras.length > 0 || editing))
  const notificationsPopup = useWidgetWindow('notifications', enabled && widgets.notifications.enabled && (notifying || editing))

  return (
    <LucideProvider strokeWidth={1.8}>
      {voicePopup &&
        createPortal(
          <VoiceWidget
            popup={voicePopup}
            editing={editing && widgets.voice.enabled}
            people={widgets.voice.enabled ? voice : []}
            preview={preview}
            notice={notice}
            ask={ask}
          />,
          voicePopup.document.body
        )}
      {camerasPopup &&
        createPortal(<CamerasWidget popup={camerasPopup} editing={editing} people={cameras} meId={me.id} />, camerasPopup.document.body)}
      {notificationsPopup &&
        createPortal(
          <NotificationsWidget popup={notificationsPopup} editing={editing} notifications={notifications} />,
          notificationsPopup.document.body
        )}
    </LucideProvider>
  )
}

/** Notifies who joins and leaves the call we're in, and a call ringing for us. */
function useCallNotifications(me: Me): void {
  const version = useVoice((s) => s.version)
  const phase = useVoice((s) => s.phase)
  const channelId = useVoice((s) => s.channelId)
  const ringing = useSocial((s) => s.ringing)
  const info = useCallContext(me.id)
  const people = useRef(info?.people)
  people.current = info?.people ?? people.current
  const room = useRef<{ channelId: string; ids: Set<string> } | null>(null)
  const ringingCall = ringing?.call

  useEffect(() => {
    if (phase === 'idle' || !channelId) room.current = null
    // A reconnecting room looks empty for a moment: compare only once it's back.
    if (phase !== 'connected' || !channelId) return
    const ids = new Set(roomIdentities())
    const before = room.current
    room.current = { channelId, ids }
    if (before?.channelId !== channelId) return // just got here: everyone was already in it
    const { joined, left } = callChanges(before.ids, ids, me.id)
    const say = (id: string, kind: OverlayNotification['kind']): void => {
      const user = people.current?.get(id)
      notifyOverlay({ kind, name: user?.display_name ?? 'Alguém', avatarUrl: user?.avatar_url })
    }
    joined.forEach((id) => say(id, 'joined'))
    left.forEach((id) => say(id, 'left'))
  }, [version, phase, channelId, me.id])

  useEffect(() => {
    if (!ringingCall) return
    const dm = useSocial.getState().dms[ringingCall.channel_id]
    const caller = dm?.members.find((m) => m.user.id === ringingCall.started_by)?.user
    notifyOverlay({ kind: 'call', name: caller?.display_name ?? 'Alguém', avatarUrl: caller?.avatar_url })
    // Once per call, however many times it's updated while ringing.
  }, [ringingCall?.id])
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

interface CallPerson extends Person {
  camera: Track | undefined
  /** Speaking now or a moment ago (SPEAKING_HOLD_MS), so pauses don't reshuffle the cameras. */
  spokeRecently: boolean
}

/** Edit mode with nobody's camera on: as many samples as can show, so the box is at its biggest. */
const sampleCameras = (count: number): CallPerson[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `preview-camera-${i}`,
    name: count > 1 ? `Exemplo ${i + 1}` : 'Exemplo',
    avatarUrl: null,
    speaking: false,
    spokeRecently: false,
    muted: false,
    deafened: false,
    camera: undefined
  }))

/**
 * Who each widget shows: everyone in the call goes to the voice list or, with a camera on, to the
 * cameras; a sample while placing the widgets with nobody there.
 */
function usePeople(me: Me, editing: boolean, widgets: OverlayWidgets): { voice: Person[]; cameras: CallPerson[]; preview: boolean } {
  useVoice((s) => s.version) // re-read the room on participant/track changes
  const speaking = useVoice((s) => s.speaking)
  const ownMuted = useVoice((s) => s.muted || !s.allowed.mic)
  const ownDeafened = useVoice((s) => s.deafened || s.serverDeafened)
  const info = useCallContext(me.id)
  const lastSpoke = useRef(new Map<string, number>())
  const [, setTick] = useState(0)
  const onlySpeaking = widgets.voice.onlySpeaking

  const now = Date.now()
  for (const id of speaking) lastSpoke.current.set(id, now)
  const recentlySpoke = (id: string): boolean => now - (lastSpoke.current.get(id) ?? 0) < SPEAKING_HOLD_MS

  // Re-render when the next held speaker should drop off (from the list, or out of the cameras shown).
  const nextDrop = Math.min(...[...lastSpoke.current.values()].map((t) => t + SPEAKING_HOLD_MS).filter((t) => t > now))
  useEffect(() => {
    if (!Number.isFinite(nextDrop)) return
    const timer = setTimeout(() => setTick((t) => t + 1), nextDrop - Date.now() + 20)
    return () => clearTimeout(timer)
  }, [nextDrop])

  if (!info) {
    if (!editing) return { preview: false, voice: [], cameras: [] }
    return {
      preview: true,
      voice: [
        { id: me.id, name: me.display_name, avatarUrl: me.avatar_url, speaking: true, muted: false, deafened: false },
        { id: 'preview', name: 'Exemplo', avatarUrl: null, speaking: false, muted: true, deafened: false }
      ],
      cameras: sampleCameras(widgets.cameras.maxVisible)
    }
  }

  const people = roomIdentities().map((id): CallPerson => {
    const isMe = id === me.id
    const voice = info.present.find((v) => v.user_id === id)
    const user = isMe ? me : info.people.get(id)
    return {
      id,
      name: user?.display_name ?? 'Alguém',
      avatarUrl: user?.avatar_url,
      speaking: speaking.includes(id),
      spokeRecently: recentlySpoke(id),
      muted: isMe ? ownMuted : !!(voice?.muted || voice?.server_muted),
      deafened: isMe ? ownDeafened : !!voice?.deafened,
      camera: cameraTrackOf(id)
    }
  })
  const { voice, cameras } = splitPeople(people, widgets.cameras.enabled)
  return {
    preview: false,
    voice: onlySpeaking ? voice.filter((p) => p.speaking || recentlySpoke(p.id)) : voice,
    cameras: cameras.length || !editing ? cameras : sampleCameras(widgets.cameras.maxVisible)
  }
}

/** Which screen corner the box is nearest to: content hugs that side, so it grows away from it. */
function anchorOf(popup: Window): { right: boolean; bottom: boolean } {
  const s = popup.screen as Screen & { availLeft: number; availTop: number }
  return {
    right: popup.screenX + popup.outerWidth / 2 > s.availLeft + s.availWidth / 2,
    bottom: popup.screenY + popup.outerHeight / 2 > s.availTop + s.availHeight / 2
  }
}

const WIDGET_NAME: Record<OverlayWidget, string> = { voice: 'Voz', cameras: 'Câmeras', notifications: 'Notificações' }

/**
 * A widget's box: content hugs the nearest screen corner, and edit mode moves and resizes it.
 * With `resizeContent`, the handle sits on the side away from that corner and resizes what's
 * inside instead of the box (the cameras' box follows its cameras): called when a drag starts, it
 * gives what to do as the pointer moves `grow` px away from the corner.
 */
function WidgetBox({
  widget,
  popup,
  editing,
  outside,
  bar,
  resizeContent,
  children
}: {
  widget: OverlayWidget
  popup: Window
  editing: boolean
  /** Over the widget, not part of it: its opacity doesn't apply. */
  outside?: ReactNode
  /** The widget's own controls on the edit bar. */
  bar?: ReactNode
  resizeContent?: () => (grow: { x: number; y: number }) => void
  children: ReactNode
}): ReactNode {
  const prefs = useOverlay((s) => s.state!.prefs.widgets[widget])
  const cameraCorner = useOverlay((s) => s.state!.cameraCorner)
  const [, setMoved] = useState(0)
  // The cameras' box is pinned by the main process (it sizes it); the others hug the nearest corner.
  const anchor =
    widget === 'cameras' ? { right: cameraCorner.endsWith('right'), bottom: cameraCorner.startsWith('bottom') } : anchorOf(popup)

  // Esc / Enter end edit mode (one of the widgets has the focus while editing).
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
      const resizeTo = mode === 'resize' ? resizeContent?.() : undefined
      let frame = 0
      let latest: OverlayBounds = start
      let grow = { x: 0, y: 0 }
      const send = (): Promise<void> => {
        if (!resizeTo) return window.aureum.overlay.setBounds(widget, latest)
        resizeTo(grow)
        return Promise.resolve()
      }
      const move = (ev: globalThis.PointerEvent): void => {
        const dx = ev.screenX - from.x
        const dy = ev.screenY - from.y
        latest =
          mode === 'move'
            ? { ...start, x: start.x + dx, y: start.y + dy }
            : { ...start, width: start.width + dx, height: start.height + dy }
        grow = { x: anchor.right ? -dx : dx, y: anchor.bottom ? -dy : dy }
        // One IPC call per frame at most.
        if (!frame) {
          frame = popup.requestAnimationFrame(() => {
            frame = 0
            void send()
          })
        }
      }
      const up = (): void => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
        if (frame) popup.cancelAnimationFrame(frame)
        void send().then(() => setMoved((n) => n + 1))
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
        editing ? 'cursor-move rounded-panel border-2 border-dashed border-accent bg-scrim/50 pt-11' : ''
      }`}
      style={{ fontSize: 14 * SCALE[prefs.size] }}
    >
      {editing && (
        <div className="pointer-events-auto absolute inset-x-2 top-2 z-10 flex items-center gap-2 rounded-control bg-panel/95 px-2.5 py-1.5 text-xs text-fg shadow-lg">
          <span className="min-w-0 flex-1 truncate font-semibold">{WIDGET_NAME[widget]}</span>
          {bar}
          <button
            type="button"
            onClick={() => void window.aureum.overlay.setEditing(false)}
            className="shrink-0 rounded-item bg-accent px-2 py-0.5 font-semibold text-on-accent"
          >
            Concluir
          </button>
        </div>
      )}

      {outside}

      <div className="max-h-full max-w-full" style={{ opacity: prefs.opacity / 100 }}>
        {children}
      </div>

      {editing && (
        <span
          data-handle
          title={resizeContent ? 'Arraste para mudar o tamanho' : 'Redimensionar'}
          onPointerDown={dragWith('resize')}
          className={`absolute bottom-1 z-10 rounded-item bg-panel/95 p-1 text-fg-muted ${
            resizeContent && anchor.right ? 'left-1 cursor-nesw-resize' : 'right-1 cursor-nwse-resize'
          }`}
        >
          <MoveDiagonal2 size={14} className={resizeContent && anchor.right ? '-scale-x-100' : undefined} />
        </span>
      )}
    </div>
  )
}

function VoiceWidget({
  popup,
  editing,
  people,
  preview,
  notice,
  ask
}: {
  popup: Window
  editing: boolean
  people: Person[]
  preview: boolean
  notice: string | null
  ask: string | null
}): ReactNode {
  const size = useOverlay((s) => s.state!.prefs.widgets.voice.size)
  const anchor = anchorOf(popup)
  return (
    <WidgetBox
      widget="voice"
      popup={popup}
      editing={editing}
      outside={
        <>
          {preview && editing && <span className="rounded-item bg-panel/95 px-2 text-xs text-fg-muted">Prévia · Esc para concluir</span>}
          {notice && !editing && (
            <div role="status" className="max-w-full rounded-control bg-panel/95 px-3 py-1.5 text-[0.85em] font-medium text-fg shadow-lg">
              {notice}
            </div>
          )}
          {ask && !editing && <AskIfGame app={ask} />}
        </>
      }
    >
      <div className={`flex flex-col gap-1.5 ${anchor.right ? 'items-end' : 'items-start'}`}>
        {people.map((p) => (
          <PersonRow key={p.id} person={p} scale={SCALE[size]} />
        ))}
      </div>
    </WidgetBox>
  )
}

/**
 * The cameras, at most `maxVisible` plus whoever is speaking, "+N" on the last one. The main process
 * sizes the window to them with the same cameraLayout (told how many there are).
 */
function CamerasWidget({ popup, editing, people, meId }: { popup: Window; editing: boolean; people: CallPerson[]; meId: string }): ReactNode {
  const prefs = useOverlay((s) => s.state!.prefs.widgets.cameras)
  const { shown, hidden } = visibleCameras(people, prefs.maxVisible, (p) => p.spokeRecently)
  const count = Math.max(1, shown.length)
  useEffect(() => void window.aureum.overlay.setCameraCount(count), [count])
  const screen = popup.screen
  const layout = cameraLayout(prefs, count, editing, { width: screen.availWidth, height: screen.availHeight })
  const set = (patch: Partial<OverlayCameraPrefs>): void => void setOverlayPrefs({ widgets: { cameras: patch } })
  // The handle changes the cameras' width; the box follows them.
  const resizeContent = (): ((grow: { x: number; y: number }) => void) => {
    const start = layout.tileWidth
    let sent = prefs.tileWidth
    return (grow: { x: number; y: number }): void => {
      const tileWidth = tileWidthAfterDrag(start, grow, layout.columns, layout.rows)
      if (tileWidth === sent) return
      sent = tileWidth
      set({ tileWidth })
    }
  }
  return (
    <WidgetBox
      widget="cameras"
      popup={popup}
      editing={editing}
      bar={<CameraEditBar prefs={prefs} set={set} />}
      resizeContent={resizeContent}
    >
      <CameraTiles columns={layout.columns} tileWidth={layout.tileWidth} gap={prefs.gap}>
        {shown.map((p, i) => (
          <CameraCard key={p.id} person={p} width={layout.tileWidth} rounded={prefs.rounded} more={i === shown.length - 1 ? hidden : 0}>
            {p.camera && <OverlayVideo track={p.camera} mirror={p.id === meId} />}
          </CameraCard>
        ))}
      </CameraTiles>
    </WidgetBox>
  )
}

const SAMPLE_NOTIFICATION: OverlayNotification = { id: 0, kind: 'dm', name: 'Exemplo', username: 'exemplo', text: 'Assim aparece uma mensagem' }

function NotificationsWidget({
  popup,
  editing,
  notifications
}: {
  popup: Window
  editing: boolean
  notifications: OverlayNotification[]
}): ReactNode {
  const { size, hideContent } = useOverlay((s) => s.state!.prefs.widgets.notifications)
  const shown = editing && !notifications.length ? [SAMPLE_NOTIFICATION] : notifications
  return (
    <WidgetBox widget="notifications" popup={popup} editing={editing}>
      <div className="flex w-[calc(100vw-1.5rem)] max-w-full flex-col gap-1.5">
        {shown.map((n) => (
          <NotificationCard key={n.id} notification={n} hideContent={hideContent} scale={SCALE[size]} />
        ))}
      </div>
    </WidgetBox>
  )
}

/**
 * "Isso é um jogo?" about an unknown program filling the screen. The overlay stays click-through
 * except while the pointer is over this box, and never takes the focus from the game.
 */
function AskIfGame({ app }: { app: string }): ReactNode {
  const hover = (hovered: boolean) => (): void => void window.aureum.overlay.setAskHovered(hovered)
  useEffect(() => () => void window.aureum.overlay.setAskHovered(false), [])
  return (
    <div
      role="alertdialog"
      aria-label="Isso é um jogo?"
      onMouseEnter={hover(true)}
      onMouseLeave={hover(false)}
      className="max-w-full rounded-control bg-panel/95 px-3 py-2 text-[0.85em] text-fg shadow-lg"
    >
      <p className="font-semibold">Isso é um jogo?</p>
      <p className="truncate text-fg-muted">Mostrar o overlay em {app}.exe</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void window.aureum.overlay.answer(true)}
          className="rounded-item bg-accent px-2.5 py-0.5 font-semibold text-on-accent"
        >
          Mostrar
        </button>
        <button
          type="button"
          onClick={() => void window.aureum.overlay.answer(false)}
          className="rounded-item border border-line px-2.5 py-0.5 font-medium text-fg-muted hover:text-fg"
        >
          Não é jogo
        </button>
      </div>
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
      className="h-full w-full object-contain"
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
    />
  )
}
