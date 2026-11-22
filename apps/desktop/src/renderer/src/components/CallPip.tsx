import { Maximize2, Minimize2, SquareArrowOutUpRight } from 'lucide-react'
import { useRef, useState, type PointerEvent, type ReactNode } from 'react'

import { pickFocus, thumbnails, type Tile } from '../lib/callFocus'
import { useCallOnScreen, useNav, type Corner } from '../store/nav'
import { roomIdentities, useVoice } from '../store/voice'
import { CallButtons, useCallContext } from './CallCard'
import { callTiles, ParticipantTile, ScreenTile } from './VoiceView'
import { t } from '../lib/i18n'

const CORNER_CLASS: Record<Corner, string> = {
  'top-left': 'left-4 top-16',
  'top-right': 'right-4 top-16',
  'bottom-left': 'bottom-4 left-4',
  'bottom-right': 'bottom-4 right-4'
}

/** Thumbnails under the big tile; the rest show as "+N". */
const MAX_THUMBNAILS = 3

/**
 * Who the floating window (and the detached one) shows big, out of `tiles` (block 4.2.9; see
 * lib/callFocus.ts). The pin is the call screen's own, so pinning here pins there too.
 */
export function useCallFocus(meId: string, tiles: Tile[]): { focused: Tile | undefined; pin(key: string): void } {
  const channelId = useVoice((s) => s.channelId)
  const speaking = useVoice((s) => s.speaking)
  const pinned = useNav((s) => (channelId && s.callPin?.channelId === channelId ? s.callPin.key : null))
  const previous = useRef<string | null>(null)
  const focused = pickFocus(tiles, { pinned, meId, speaking, previous: previous.current })
  previous.current = focused?.key ?? null
  return {
    focused,
    pin: (key) => {
      if (channelId) useNav.getState().setCallPin(channelId, key)
    }
  }
}

/** Floating call window (picture-in-picture), draggable to any of the 4 corners. It looks like the
 * call screen in focus mode: one big tile, the others as thumbnails that pin whoever is clicked. */
export function CallPip({ meId }: { meId: string }): ReactNode {
  const info = useCallContext(meId)
  const phase = useVoice((s) => s.phase)
  useVoice((s) => s.version) // re-render on room changes
  const speaking = useVoice((s) => s.speaking)
  const minimized = useNav((s) => s.pipMinimized)
  const detached = useNav((s) => s.callDetached)
  const corner = useNav((s) => s.pipCorner)
  const { setPipCorner, setPipMinimized, setCallDetached } = useNav.getState()
  const onScreen = useCallOnScreen()
  const tiles = callTiles(phase === 'connecting' ? [meId] : roomIdentities())
  const { focused, pin } = useCallFocus(meId, tiles)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Detached, the call's own window takes its place.
  if (!info || minimized || onScreen || detached) return null

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    // Buttons and thumbnails are clicked, not dragged.
    if ((e.target as HTMLElement).closest('button, [role="button"]') || !ref.current) return
    // Grabbing the photo would start the browser's own image drag (which can drop it in the chat as
    // an attachment) and select text on the way: moving the window is all this gesture does.
    e.preventDefault()
    const rect = ref.current.getBoundingClientRect()
    const dx = e.clientX - rect.left
    const dy = e.clientY - rect.top
    const el = e.currentTarget
    el.setPointerCapture?.(e.pointerId)
    const body = document.body.style
    const userSelect = body.userSelect
    body.userSelect = 'none'
    const move = (ev: globalThis.PointerEvent): void => setDrag({ x: ev.clientX - dx, y: ev.clientY - dy })
    const stop = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', stop)
      body.userSelect = userSelect
      setDrag(null)
    }
    const up = (ev: globalThis.PointerEvent): void => {
      stop()
      // Snap to the corner nearest to where the window's center was dropped.
      const cx = ev.clientX - dx + rect.width / 2
      const cy = ev.clientY - dy + rect.height / 2
      const vertical = cy < window.innerHeight / 2 ? 'top' : 'bottom'
      const horizontal = cx < window.innerWidth / 2 ? 'left' : 'right'
      setPipCorner(`${vertical}-${horizontal}`)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', stop)
  }

  const render = (tile: Tile, size: 'pip' | 'mini'): ReactNode => {
    const props = {
      identity: tile.identity,
      user: info.people.get(tile.identity),
      isLocal: tile.identity === meId,
      size,
      onClick: size === 'mini' ? () => pin(tile.key) : undefined
    }
    return tile.kind === 'screen' ? (
      <ScreenTile key={tile.key} {...props} />
    ) : (
      <ParticipantTile key={tile.key} {...props} speaking={speaking.includes(tile.identity)} meId={meId} />
    )
  }
  const { shown, more } = thumbnails(tiles, focused, MAX_THUMBNAILS)
  const iconButton = 'rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg'

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t('call.callIn', { room: info.room })}
      onPointerDown={onPointerDown}
      onDragStart={(e) => e.preventDefault()}
      style={drag ? { left: drag.x, top: drag.y } : undefined}
      className={`fixed z-float w-80 cursor-grab touch-none select-none overflow-hidden rounded-panel border border-line bg-rail shadow-2xl active:cursor-grabbing ${
        drag ? '' : CORNER_CLASS[corner]
      }`}
    >
      <div className="relative flex aspect-video p-1.5 pb-0">{focused && render(focused, 'pip')}</div>
      {(shown.length > 0 || more > 0) && (
        <div className="flex gap-1.5 px-1.5 pt-1.5" data-pip-thumbnails>
          {shown.map((tile) => (
            <div key={tile.key} className="w-16 shrink-0">
              {render(tile, 'mini')}
            </div>
          ))}
          {more > 0 && (
            <button
              type="button"
              title={t('call.pip.more', { count: more })}
              aria-label={t('call.pip.more', { count: more })}
              onClick={info.open}
              className="flex aspect-video w-16 shrink-0 items-center justify-center rounded-control bg-panel text-xs font-semibold text-fg-muted hover:bg-elevated hover:text-fg"
            >
              +{more}
            </button>
          )}
        </div>
      )}
      <div className="flex items-center gap-0.5 px-2 pb-1.5 pt-1">
        <CallButtons size={16} compact />
        <span className="min-w-0 flex-1 truncate px-1 text-xs text-fg-subtle">{info.room}</span>
        <button type="button" title={t('call.pip.back')} aria-label={t('call.pip.back')} onClick={info.open} className={iconButton}>
          <Maximize2 size={18} />
        </button>
        <button type="button" title={t('call.detach')} aria-label={t('call.detach')} onClick={() => setCallDetached(true)} className={iconButton}>
          <SquareArrowOutUpRight size={16} />
        </button>
        <button type="button" title={t('call.hidePip')} aria-label={t('call.hidePip')} onClick={() => setPipMinimized(true)} className={iconButton}>
          <Minimize2 size={16} />
        </button>
      </div>
    </div>
  )
}
