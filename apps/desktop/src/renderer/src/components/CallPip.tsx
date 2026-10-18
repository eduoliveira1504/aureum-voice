import { Expand, Maximize2, Minimize2 } from 'lucide-react'
import { useRef, useState, type PointerEvent, type ReactNode } from 'react'

import { useCallOnScreen, useNav, type Corner } from '../store/nav'
import { cameraTrackOf, roomIdentities, screenTrackOf, useVoice } from '../store/voice'
import { CallButtons, useCallContext } from './CallCard'
import { Avatar } from './ui'
import { VideoTrackView } from './VoiceView'

const CORNER_CLASS: Record<Corner, string> = {
  'top-left': 'left-4 top-16',
  'top-right': 'right-4 top-16',
  'bottom-left': 'bottom-4 left-4',
  'bottom-right': 'bottom-4 right-4'
}

/** Picks what the floating window shows: someone else's screen, else who's speaking. */
function useSubject(meId: string): { identity: string; kind: 'screen' | 'person' } | null {
  useVoice((s) => s.version) // re-render on room changes
  const speaking = useVoice((s) => s.speaking)
  const lastSpeaker = useRef<string | null>(null)
  const ids = roomIdentities()
  if (ids.length === 0) return null

  const screen = ids.find((id) => id !== meId && screenTrackOf(id))
  if (screen) return { identity: screen, kind: 'screen' }
  const talking = speaking.find((id) => id !== meId) ?? speaking[0]
  if (talking) lastSpeaker.current = talking
  // Between sentences keep showing the last speaker instead of flickering.
  const shown = lastSpeaker.current && ids.includes(lastSpeaker.current) ? lastSpeaker.current : (ids.find((id) => id !== meId) ?? meId)
  return { identity: shown, kind: 'person' }
}

/** Floating call window (picture-in-picture), draggable to any of the 4 corners. */
export function CallPip({ meId }: { meId: string }): ReactNode {
  const info = useCallContext(meId)
  const speaking = useVoice((s) => s.speaking)
  const minimized = useNav((s) => s.pipMinimized)
  const corner = useNav((s) => s.pipCorner)
  const { setPipCorner, setPipMinimized, setCallFullscreen } = useNav.getState()
  const onScreen = useCallOnScreen()
  const subject = useSubject(meId)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  if (!info || minimized || onScreen) return null

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('button') || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const dx = e.clientX - rect.left
    const dy = e.clientY - rect.top
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent): void => setDrag({ x: ev.clientX - dx, y: ev.clientY - dy })
    const up = (ev: globalThis.PointerEvent): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setDrag(null)
      // Snap to the corner nearest to where the window's center was dropped.
      const cx = ev.clientX - dx + rect.width / 2
      const cy = ev.clientY - dy + rect.height / 2
      const vertical = cy < window.innerHeight / 2 ? 'top' : 'bottom'
      const horizontal = cx < window.innerWidth / 2 ? 'left' : 'right'
      setPipCorner(`${vertical}-${horizontal}`)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const person = subject ? info.people.get(subject.identity) : undefined
  const name = subject?.identity === meId ? 'Você' : (person?.display_name ?? 'Alguém')
  // The window is small, so adaptiveStream subscribes to the lowest video layer.
  const track = subject ? (subject.kind === 'screen' ? screenTrackOf(subject.identity) : cameraTrackOf(subject.identity)) : undefined
  const iconButton = 'rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg'

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Chamada em ${info.room}`}
      onPointerDown={onPointerDown}
      style={drag ? { left: drag.x, top: drag.y } : undefined}
      className={`fixed z-30 w-80 cursor-grab touch-none select-none overflow-hidden rounded-panel border border-line bg-panel shadow-2xl active:cursor-grabbing ${
        drag ? '' : CORNER_CLASS[corner]
      }`}
    >
      <div className="relative flex aspect-video items-center justify-center bg-scrim">
        {track ? (
          <VideoTrackView track={track} mirror={subject?.identity === meId && subject.kind === 'person'} fit={subject?.kind === 'screen' ? 'contain' : 'cover'} />
        ) : (
          subject && (
            <span className={`rounded-full ${speaking.includes(subject.identity) ? 'ring-[3px] ring-accent' : ''}`}>
              <Avatar name={person?.display_name ?? name} url={person?.avatar_url} size={64} />
            </span>
          )
        )}
        {subject?.kind === 'screen' && (
          <span className="absolute left-2 top-2 rounded bg-danger px-1.5 text-[10px] font-bold leading-5 text-on-danger">AO VIVO</span>
        )}
        {subject && (
          <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-item bg-scrim/60 px-2 py-0.5 text-xs text-on-scrim">
            {subject.kind === 'screen' ? `Tela de ${name}` : name}
          </span>
        )}
      </div>
      <div className="px-3 pb-2 pt-2.5">
        <div className="truncate text-sm font-semibold">{info.room}</div>
        <div className="truncate text-xs text-fg-subtle">{info.speakingText}</div>
        <div className="mt-1.5 flex items-center gap-0.5">
          <CallButtons compact />
          <span className="flex-1" />
          <button type="button" title="Expandir" aria-label="Expandir" onClick={info.open} className={iconButton}>
            <Maximize2 size={18} />
          </button>
          <button type="button" title="Tela cheia" aria-label="Tela cheia" onClick={() => setCallFullscreen(true)} className={iconButton}>
            <Expand size={18} />
          </button>
          <button type="button" title="Esconder janelinha" aria-label="Esconder janelinha" onClick={() => setPipMinimized(true)} className={iconButton}>
            <Minimize2 size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
