import { ChevronLeft, ChevronRight, Download, Minus, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from 'react'
import { createPortal } from 'react-dom'

import { formatSize, useAttachmentUrl } from '../lib/attachments'
import { closeImages, saveImage, useImageViewer, type ViewableImage } from '../lib/chatImages'
import { toast } from './ContextMenu'
import { useImageMenu } from './ImageMenu'

const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4]

/** The viewer opened from a message's images or from "Abrir imagem" (rendered once, in AppShell).
 * Under the right-click menu's layer (z-50), so the image's own menu opens over it. */
export function ImageViewerHost(): ReactNode {
  const open = useImageViewer((s) => s.open)
  return open ? <ImageViewer images={open.images} start={open.start} onClose={closeImages} /> : null
}

interface PictureProps {
  image: ViewableImage
  zoom: number
  offset: { x: number; y: number }
  onPointerDown(e: PointerEvent): void
  onPointerMove(e: PointerEvent): void
  onPointerUp(): void
}

function AttachmentPicture(props: PictureProps & { image: Extract<ViewableImage, { kind: 'attachment' }> }): ReactNode {
  const { url } = useAttachmentUrl(props.image.attachment)
  return url ? <Picture {...props} url={url} /> : null
}

/** The image itself: zoom, drag to pan, and its own right-click menu (copy, save). */
function Picture({ image, url, zoom, offset, onPointerDown, onPointerMove, onPointerUp }: PictureProps & { url: string }): ReactNode {
  const onContextMenu = useImageMenu(image, null)
  return (
    <img
      src={url}
      alt={image.name}
      draggable={false}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
      className={`max-h-full max-w-full select-none object-contain transition-transform duration-100 ${zoom > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
    />
  )
}

/** Full-screen viewer for images: zoom (wheel or buttons), drag to pan, arrows to move between
 * them, Esc to close. */
function ImageViewer({ images, start, onClose }: { images: ViewableImage[]; start: number; onClose(): void }): ReactNode {
  const [index, setIndex] = useState(start)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  const image = images[Math.min(index, images.length - 1)]

  const go = useCallback(
    (step: number) => {
      setIndex((i) => (i + step + images.length) % images.length)
      setZoom(1)
      setOffset({ x: 0, y: 0 })
    },
    [images.length]
  )
  const zoomBy = (direction: 1 | -1): void => {
    setZoom((z) => {
      const next = direction > 0 ? ZOOM_STEPS.find((s) => s > z) : [...ZOOM_STEPS].reverse().find((s) => s < z)
      if ((next ?? z) <= 1) setOffset({ x: 0, y: 0 })
      return next ?? z
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && images.length > 1) go(1)
      else if (e.key === 'ArrowLeft' && images.length > 1) go(-1)
      else if (e.key === '+' || e.key === '=') zoomBy(1)
      else if (e.key === '-') zoomBy(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, images.length, onClose])

  const onWheel = (e: WheelEvent): void => zoomBy(e.deltaY < 0 ? 1 : -1)
  const picture: Omit<PictureProps, 'image'> = {
    zoom,
    offset,
    onPointerDown: (e) => {
      if (zoom <= 1) return
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }
    },
    onPointerMove: (e) => {
      if (drag.current) setOffset({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })
    },
    onPointerUp: () => (drag.current = null)
  }
  const size = image.kind === 'attachment' ? image.attachment.size : null

  const tool = 'rounded-item p-2 text-fg-muted hover:bg-elevated hover:text-fg disabled:opacity-40'
  return createPortal(
    <div className="app-no-drag fixed inset-0 z-[45] flex flex-col bg-scrim/90" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pr-window-controls flex h-12 shrink-0 items-center gap-1 border-b border-line bg-panel pl-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{image.name}</p>
          <p className="text-xs text-fg-subtle">
            {size !== null && formatSize(size)}
            {size !== null && images.length > 1 && ' · '}
            {images.length > 1 && `${index + 1} de ${images.length}`}
          </p>
        </div>
        <button type="button" title="Diminuir zoom" aria-label="Diminuir zoom" className={tool} disabled={zoom <= ZOOM_STEPS[0]} onClick={() => zoomBy(-1)}>
          <Minus size={18} />
        </button>
        <button
          type="button"
          title="Tamanho original"
          onClick={() => {
            setZoom(1)
            setOffset({ x: 0, y: 0 })
          }}
          className="w-14 rounded-item py-1 text-center text-sm tabular-nums text-fg-muted hover:bg-elevated hover:text-fg"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" title="Aumentar zoom" aria-label="Aumentar zoom" className={tool} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} onClick={() => zoomBy(1)}>
          <Plus size={18} />
        </button>
        <button
          type="button"
          title="Salvar imagem como…"
          aria-label="Salvar imagem como…"
          className={tool}
          onClick={() => void saveImage(image).catch(() => toast('Não foi possível salvar a imagem.'))}
        >
          <Download size={18} />
        </button>
        <button type="button" title="Fechar (Esc)" aria-label="Fechar" className={tool} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        onWheel={onWheel}
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        {image.kind === 'attachment' ? (
          <AttachmentPicture key={image.attachment.id} image={image} {...picture} />
        ) : (
          <Picture key={image.url} image={image} url={image.url} {...picture} />
        )}
        {images.length > 1 && (
          <>
            <button type="button" aria-label="Anterior" onClick={() => go(-1)} className="absolute left-4 rounded-full bg-panel/80 p-2 text-fg hover:bg-panel">
              <ChevronLeft size={22} />
            </button>
            <button type="button" aria-label="Próxima" onClick={() => go(1)} className="absolute right-4 rounded-full bg-panel/80 p-2 text-fg hover:bg-panel">
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
