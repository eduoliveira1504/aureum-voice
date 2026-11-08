import { AppWindow, LayoutGrid, Pin, PinOff, Presentation, X } from 'lucide-react'
import type { Track } from 'livekit-client'
import { useEffect, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { CALL_FRAME_NAME } from '../../../shared/callWindow'
import type { User } from '../lib/api'
import { preparePopup } from '../lib/popupDocument'
import { useNav } from '../store/nav'
import { cameraTrackOf, roomIdentities, screenTrackOf, useVoice } from '../store/voice'
import { CallButtons, useCallContext } from './CallCard'
import { useSubject } from './CallPip'
import { PopupVideo } from './PopupVideo'
import { Avatar, TileRing } from './ui'
import { SoundboardControl } from './VoiceView'

type Layout = 'focus' | 'grid'

/** Opens the call's window while it's wanted; null while it's closed. Closing it from outside
 *  (Alt+F4, the taskbar) is the same as its X: back to the floating window, still in the call. */
function useCallPopup(wanted: boolean): Window | null {
  const [popup, setPopup] = useState<Window | null>(null)

  useEffect(() => {
    if (!wanted) return
    // A unique name, so a window still closing is never reused (the main process checks it).
    const child = window.open('about:blank', `${CALL_FRAME_NAME}-${Date.now()}`)
    if (!child) {
      useNav.getState().setCallDetached(false)
      return
    }
    const stopSync = preparePopup(child.document, { title: 'Aureum Voice — chamada', transparent: false })
    setPopup(child)
    const onGone = (): void => {
      stopSync()
      setPopup((p) => (p === child ? null : p))
      useNav.getState().setCallDetached(false)
    }
    child.addEventListener('pagehide', onGone)
    return () => {
      child.removeEventListener('pagehide', onGone)
      stopSync()
      child.close()
      setPopup((p) => (p === child ? null : p))
    }
  }, [wanted])

  return popup
}

/**
 * The call in a window of its own, above the other programs (block 3.20 B).
 *
 * It's a popup of this window (window.open) rendered with a portal, so it lives in this same
 * process: it reads the same stores and plays the tracks of the call's own LiveKit room. Nothing
 * here joins or connects; there is one connection, whichever window shows the call.
 */
export function DetachedCallHost({ meId }: { meId: string }): ReactNode {
  const detached = useNav((s) => s.callDetached)
  const inCall = useVoice((s) => s.phase !== 'idle')

  // Leaving the call closes the window.
  useEffect(() => {
    if (!inCall && detached) useNav.getState().setCallDetached(false)
  }, [inCall, detached])

  const popup = useCallPopup(detached && inCall)
  if (!popup) return null
  return createPortal(<DetachedCall popup={popup} meId={meId} />, popup.document.body)
}

interface Tile {
  key: string
  identity: string
  kind: 'screen' | 'person'
}

function DetachedCall({ popup, meId }: { popup: Window; meId: string }): ReactNode {
  const info = useCallContext(meId)
  const subject = useSubject(meId)
  const [layout, setLayout] = useState<Layout>('focus')
  const [pinned, setPinned] = useState(true)
  const [hover, setHover] = useState(false)

  useEffect(() => {
    void window.aureum.callWindow.getPinned().then(setPinned)
  }, [])

  if (!info) return null

  const ids = roomIdentities()
  const tiles: Tile[] = [
    ...ids.filter((id) => screenTrackOf(id)).map((id): Tile => ({ key: `${id}:screen`, identity: id, kind: 'screen' })),
    ...ids.map((id): Tile => ({ key: `${id}:person`, identity: id, kind: 'person' }))
  ]
  const grid = layout === 'grid' && tiles.length > 1

  const togglePin = (): void => {
    const next = !pinned
    setPinned(next)
    void window.aureum.callWindow.setPinned(next)
  }
  const close = (): void => useNav.getState().setCallDetached(false)
  const backToApp = (): void => {
    close()
    void window.aureum.window.show()
  }

  // Dragged by any part that isn't a control, like the floating window (block 3.20 A): the
  // gesture never starts the browser's own image drag or selects text.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, select, input')) return
    e.preventDefault()
    const el = e.currentTarget
    const start = { x: e.screenX, y: e.screenY, left: popup.screenX, top: popup.screenY }
    el.setPointerCapture?.(e.pointerId)
    const move = (ev: globalThis.PointerEvent): void =>
      void window.aureum.callWindow.move(start.left + ev.screenX - start.x, start.top + ev.screenY - start.y)
    const stop = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', stop)
      el.removeEventListener('pointercancel', stop)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', stop)
    el.addEventListener('pointercancel', stop)
  }

  const iconButton = 'rounded-item p-1 text-fg-muted hover:bg-elevated hover:text-fg'
  // The bars float over the video and show while the pointer is over the window.
  const bars = `absolute inset-x-0 z-10 flex items-center gap-0.5 bg-panel/90 px-2 py-1 transition-opacity ${
    hover ? 'opacity-100' : 'pointer-events-none opacity-0'
  }`

  return (
    <div
      role="dialog"
      aria-label={`Chamada destacada em ${info.room}`}
      onPointerDown={onPointerDown}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onDragStart={(e) => e.preventDefault()}
      className="relative h-full w-full cursor-grab touch-none select-none overflow-hidden bg-rail text-fg active:cursor-grabbing"
    >
      {grid ? (
        <Grid tiles={tiles} people={info.people} meId={meId} />
      ) : (
        subject && (
          <CallTile
            tile={{ key: `${subject.identity}:${subject.kind}`, ...subject }}
            user={info.people.get(subject.identity)}
            meId={meId}
            avatarSize={64}
          />
        )
      )}

      <div className={`${bars} top-0`}>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{info.room}</span>
        {tiles.length > 1 && (
          <button
            type="button"
            title={grid ? 'Foco' : 'Grade'}
            aria-label={grid ? 'Mostrar em foco' : 'Mostrar em grade'}
            onClick={() => setLayout(grid ? 'focus' : 'grid')}
            className={iconButton}
          >
            {grid ? <Presentation size={16} /> : <LayoutGrid size={16} />}
          </button>
        )}
        <button
          type="button"
          title={pinned ? 'Deixar de fixar por cima' : 'Fixar por cima'}
          aria-label={pinned ? 'Deixar de fixar por cima' : 'Fixar por cima'}
          aria-pressed={pinned}
          onClick={togglePin}
          className={iconButton}
        >
          {pinned ? <Pin size={16} /> : <PinOff size={16} />}
        </button>
        <button type="button" title="Voltar ao app" aria-label="Voltar ao app" onClick={backToApp} className={iconButton}>
          <AppWindow size={16} />
        </button>
        <button type="button" title="Fechar janela destacada" aria-label="Fechar janela destacada" onClick={close} className={iconButton}>
          <X size={16} />
        </button>
      </div>

      <div className={`${bars} bottom-0 justify-center`}>
        <CallButtons size={16} detached beforeLeave={<SoundboardControl small />} />
      </div>
    </div>
  )
}

function Grid({ tiles, people, meId }: { tiles: Tile[]; people: Map<string, User>; meId: string }): ReactNode {
  const cols = Math.ceil(Math.sqrt(tiles.length))
  const rows = Math.ceil(tiles.length / cols)
  return (
    <div
      className="grid h-full w-full gap-1 p-1"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
    >
      {tiles.map((t) => (
        <CallTile key={t.key} tile={t} user={people.get(t.identity)} meId={meId} avatarSize={40} rounded />
      ))}
    </div>
  )
}

/** One person or screen: the video in contain (whole picture), else the photo, with the ring. */
function CallTile({
  tile,
  user,
  meId,
  avatarSize,
  rounded = false
}: {
  tile: Tile
  user: User | undefined
  meId: string
  avatarSize: number
  rounded?: boolean
}): ReactNode {
  const speaking = useVoice((s) => s.speaking.includes(tile.identity))
  const track: Track | undefined = tile.kind === 'screen' ? screenTrackOf(tile.identity) : cameraTrackOf(tile.identity)
  const name = tile.identity === meId ? 'Você' : (user?.display_name ?? 'Alguém')
  return (
    <div
      data-tile={tile.key}
      className={`relative flex h-full min-h-0 w-full min-w-0 items-center justify-center overflow-hidden bg-scrim ${rounded ? 'rounded-item' : ''}`}
    >
      {track ? (
        <PopupVideo track={track} mirror={tile.identity === meId && tile.kind === 'person'} />
      ) : (
        <Avatar name={user?.display_name ?? name} url={user?.avatar_url} gif={user?.avatar_gif} size={avatarSize} />
      )}
      {tile.kind === 'screen' && (
        <span className="absolute left-1.5 top-1.5 rounded bg-danger px-1.5 text-[10px] font-bold leading-5 text-on-danger">AO VIVO</span>
      )}
      <span className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-item bg-scrim/60 px-1.5 py-0.5 text-[11px] text-on-scrim">
        {tile.kind === 'screen' ? `Tela de ${name}` : name}
      </span>
      <TileRing on={tile.kind === 'person' && speaking} />
    </div>
  )
}
