import { RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

import { api, ApiError, fetchMedia, type ImageCrop } from '../lib/api'
import {
  clampView,
  cropOf,
  initialView,
  layoutOf,
  MAX_ZOOM,
  MIN_ZOOM,
  panView,
  rotateView,
  viewOf,
  zoomView,
  type CropView,
  type Size
} from '../lib/crop'
import { FormError, Modal, SecondaryButton } from './Modal'
import { labelClass, PrimaryButton } from './ui'

const MAX_BYTES = 8 * 1024 * 1024
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'
// Room around the frame where the rest of the image shows, dimmed.
const PAD = 28
const WHEEL_SPEED = 0.0015
const KEY_STEP = 12

/** What is being cropped: the frame's size and corners, and the previews next to it. */
export type CropShape = 'avatar' | 'banner' | 'icon' | 'server-banner'

interface Preview {
  label: string
  size: Size
  rounded: string
  /** Shown next to the small one, as in a member list. */
  withName?: boolean
}

const SHAPES: Record<CropShape, { frame: Size; rounded: string; previews: Preview[] }> = {
  avatar: {
    frame: { width: 280, height: 280 },
    rounded: 'rounded-full',
    previews: [
      { label: 'No cartão de perfil', size: { width: 88, height: 88 }, rounded: 'rounded-full' },
      { label: 'Ao lado do nome', size: { width: 24, height: 24 }, rounded: 'rounded-full', withName: true }
    ]
  },
  // The profile card's banner is 340 x 120.
  banner: {
    frame: { width: 408, height: 144 },
    rounded: 'rounded-control',
    previews: [{ label: 'No cartão de perfil', size: { width: 340, height: 120 }, rounded: 'rounded-control' }]
  },
  icon: {
    frame: { width: 280, height: 280 },
    rounded: 'rounded-[18%]',
    previews: [
      { label: 'No topo', size: { width: 48, height: 48 }, rounded: 'rounded-item' },
      { label: 'Nas listas', size: { width: 24, height: 24 }, rounded: 'rounded-item', withName: true }
    ]
  },
  'server-banner': {
    frame: { width: 420, height: 140 },
    rounded: 'rounded-control',
    previews: [{ label: 'Na visão geral', size: { width: 300, height: 100 }, rounded: 'rounded-control' }]
  }
}

/** The image as the view shows it, inside a box of `frame` size (overflowing it). */
function Placed({ src, view, image, frame }: { src: string; view: CropView; image: Size; frame: Size }): ReactNode {
  const { left, top, box, img } = layoutOf(view, image, frame)
  return (
    <span className="pointer-events-none absolute" style={{ left, top, ...box }}>
      <img
        src={src}
        alt=""
        draggable={false}
        className="absolute left-1/2 top-1/2 max-w-none select-none"
        style={{ ...img, transform: `translate(-50%, -50%) rotate(${view.rotate}deg)` }}
      />
    </span>
  )
}

function PreviewOf({ preview, src, view, image, name }: { preview: Preview; src: string; view: CropView; image: Size; name: string }): ReactNode {
  const box = (
    <span className={`relative block shrink-0 overflow-hidden bg-elevated ${preview.rounded}`} style={preview.size}>
      <Placed src={src} view={view} image={image} frame={preview.size} />
    </span>
  )
  return (
    <div>
      <span className={labelClass}>{preview.label}</span>
      {preview.withName ? (
        <span className="flex items-center gap-2 rounded-item bg-main px-2 py-1.5">
          {box}
          <span className="truncate text-sm font-semibold">{name}</span>
        </span>
      ) : (
        box
      )}
    </div>
  )
}

/**
 * The crop editor: drag to place, zoom 1x–4x (slider or mouse wheel), turn 90°, with live
 * previews. GIFs and WebPs keep playing here and stay animated after the crop (done by the API).
 */
export function ImageCropModal({
  src,
  shape,
  initial,
  name,
  onClose,
  onSave
}: {
  src: string
  shape: CropShape
  /** The saved crop, when adjusting an image cropped before. */
  initial?: ImageCrop | null
  /** Shown in the small preview. */
  name: string
  onClose(): void
  onSave(crop: ImageCrop): Promise<void>
}): ReactNode {
  const { frame, rounded, previews } = SHAPES[shape]
  const [image, setImage] = useState<Size | null>(null)
  const [view, setView] = useState<CropView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const probe = new Image()
    probe.onload = () => {
      const size = { width: probe.naturalWidth, height: probe.naturalHeight }
      setImage(size)
      setView(initial ? viewOf(initial, size, frame) : clampView(initialView(size), size, frame))
    }
    probe.onerror = () => setError('Não foi possível abrir a imagem.')
    probe.src = src
    // The frame is fixed per shape, and `initial` only matters on open.
  }, [src])

  // The page would scroll with a passive listener: zoom needs preventDefault.
  useEffect(() => {
    const el = stage.current
    if (!el || !image) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      setView((v) => v && zoomView(v, image, frame, v.zoom * Math.exp(-e.deltaY * WHEEL_SPEED)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [image, frame])

  const update = (next: (v: CropView, image: Size) => CropView): void => {
    if (image) setView((v) => v && next(v, image))
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const last = drag.current
    if (!last) return
    drag.current = { x: e.clientX, y: e.clientY }
    update((v, im) => panView(v, im, frame, e.clientX - last.x, e.clientY - last.y))
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [KEY_STEP, 0], ArrowRight: [-KEY_STEP, 0], ArrowUp: [0, KEY_STEP], ArrowDown: [0, -KEY_STEP] }
    if (moves[e.key]) update((v, im) => panView(v, im, frame, ...moves[e.key]))
    else if (e.key === '+' || e.key === '=') update((v, im) => zoomView(v, im, frame, v.zoom * 1.1))
    else if (e.key === '-') update((v, im) => zoomView(v, im, frame, v.zoom / 1.1))
    else return
    e.preventDefault()
  }

  async function save(): Promise<void> {
    if (!image || !view) return
    setBusy(true)
    setError(null)
    try {
      await onSave(cropOf(view, image, frame))
      onClose()
    } catch (err) {
      setError(uploadError(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="Ajustar imagem" subtitle="Arraste para posicionar. Use a roda do mouse ou o controle para dar zoom." wide onClose={onClose}>
      <div className="flex flex-wrap items-start justify-center gap-6">
        <div>
          <div
            ref={stage}
            role="application"
            aria-label="Área de recorte: arraste ou use as setas para mover, + e - para o zoom"
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={onKeyDown}
            className="relative cursor-grab touch-none overflow-hidden rounded-control bg-main outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
            style={{ width: frame.width + PAD * 2, height: frame.height + PAD * 2 }}
          >
            <div className="absolute" style={{ left: PAD, top: PAD, ...frame }}>
              {image && view && <Placed src={src} view={view} image={image} frame={frame} />}
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-0 border-2 border-on-scrim/80 ${rounded}`}
                style={{ boxShadow: '0 0 0 9999px color-mix(in srgb, var(--scrim) 60%, transparent)' }}
              />
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <ZoomOut size={16} className="shrink-0 text-fg-muted" aria-hidden />
            <input
              type="range"
              aria-label="Zoom"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={view?.zoom ?? MIN_ZOOM}
              disabled={!view}
              onChange={(e) => update((v, im) => zoomView(v, im, frame, Number(e.target.value)))}
              className="min-w-0 flex-1 accent-accent"
            />
            <ZoomIn size={16} className="shrink-0 text-fg-muted" aria-hidden />
            <button
              type="button"
              disabled={!view}
              onClick={() => update((v, im) => rotateView(v, im, frame))}
              className="ml-2 flex items-center gap-1.5 rounded-control px-2 py-1.5 text-sm font-medium text-fg-muted hover:bg-elevated hover:text-fg"
            >
              <RotateCw size={16} /> Girar 90°
            </button>
          </div>
        </div>

        {image && view && (
          <div className="min-w-0 space-y-4">
            {previews.map((p) => (
              <PreviewOf key={p.label} preview={p} src={src} view={view} image={image} name={name} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 space-y-3">
        <FormError message={error} />
        <div className="ml-auto grid w-80 grid-cols-2 gap-3">
          <SecondaryButton type="button" onClick={onClose}>
            Cancelar
          </SecondaryButton>
          <PrimaryButton type="button" disabled={!view || busy} onClick={save}>
            {busy ? 'Salvando…' : 'Salvar'}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  )
}

export function uploadError(err: unknown): string {
  if (err instanceof ApiError && err.status === 413) return 'A imagem passa de 8 MB.'
  if (err instanceof ApiError && err.status === 415) return 'Formato não suportado. Use PNG, JPG, GIF ou WebP.'
  if (err instanceof ApiError && err.status === 422) return 'Não foi possível recortar essa imagem.'
  return 'Não foi possível enviar a imagem.'
}

interface Editing {
  src: string
  /** A new file, uploaded with the crop; without it, the kept original is cropped again. */
  file: File | null
  initial: ImageCrop | null
}

/**
 * Change (pick, then crop), Ajustar posição (crop the kept original again) and Remove, for one
 * image at `path` (/users/me/avatar, /servers/{id}/icon...). `onDone` gets the API's answer.
 */
export function CroppedImageRow<T>({
  label,
  shape,
  path,
  hasImage,
  crop,
  name,
  onDone
}: {
  label: string
  shape: CropShape
  path: string
  hasImage: boolean
  /** The saved crop: the image can be adjusted without uploading it again. */
  crop: ImageCrop | null | undefined
  name: string
  onDone(result: T): void
}): ReactNode {
  const input = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lower = label.toLowerCase()

  useEffect(() => () => void (editing && URL.revokeObjectURL(editing.src)), [editing])

  function pick(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    if (!file) return
    if (file.size > MAX_BYTES) return setError('A imagem passa de 8 MB.')
    setError(null)
    setEditing({ src: URL.createObjectURL(file), file, initial: null })
  }

  async function adjust(): Promise<void> {
    setBusy('adjust')
    setError(null)
    try {
      const original = await fetchMedia(`/api${path}/original`)
      setEditing({ src: URL.createObjectURL(original), file: null, initial: crop ?? null })
    } catch {
      setError('Não foi possível abrir a imagem original.')
    } finally {
      setBusy(null)
    }
  }

  async function remove(): Promise<void> {
    setBusy('remove')
    setError(null)
    try {
      onDone(await api<T>(path, { method: 'DELETE' }))
    } catch (err) {
      setError(uploadError(err))
    } finally {
      setBusy(null)
    }
  }

  async function save(next: ImageCrop): Promise<void> {
    if (editing?.file) {
      const body = new FormData()
      body.append('file', editing.file)
      body.append('crop', JSON.stringify(next))
      onDone(await api<T>(path, { method: 'POST', body }))
    } else {
      onDone(await api<T>(`${path}/crop`, { method: 'PUT', body: next }))
    }
  }

  return (
    <div>
      <span className={labelClass}>{label}</span>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => input.current?.click()}
          className="rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          {`Alterar ${lower}`}
        </button>
        {hasImage && crop && (
          <button type="button" disabled={busy !== null} onClick={adjust} className="text-sm text-fg-muted hover:text-fg">
            {busy === 'adjust' ? 'Abrindo…' : 'Ajustar posição'}
          </button>
        )}
        {hasImage && (
          <button type="button" disabled={busy !== null} onClick={remove} className="text-sm text-fg-muted hover:text-fg">
            {busy === 'remove' ? 'Removendo…' : 'Remover'}
          </button>
        )}
        <input ref={input} type="file" accept={ACCEPT} hidden aria-label={`Arquivo de ${lower}`} onChange={pick} />
      </div>
      {error && <p role="alert" className="mt-1.5 text-sm text-danger">{error}</p>}
      {editing && (
        <ImageCropModal src={editing.src} shape={shape} initial={editing.initial} name={name} onClose={() => setEditing(null)} onSave={save} />
      )}
    </div>
  )
}

/** The picked image as an upload body, or null (nothing picked, or too big: reported). */
export function imageForm(e: ChangeEvent<HTMLInputElement>, onError: (message: string) => void): FormData | null {
  const file = e.target.files?.[0]
  e.target.value = '' // allow picking the same file again
  if (!file) return null
  if (file.size > MAX_BYTES) {
    onError('A imagem passa de 8 MB.')
    return null
  }
  const body = new FormData()
  body.append('file', file)
  return body
}

export function ImageRow({
  label,
  busy,
  hasImage,
  onPick,
  onRemove
}: {
  label: string
  busy: boolean
  hasImage: boolean
  onPick(e: ChangeEvent<HTMLInputElement>): void
  onRemove(): void
}): ReactNode {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div>
      <span className={labelClass}>{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? 'Enviando…' : `Alterar ${label.toLowerCase()}`}
        </button>
        {hasImage && (
          <button type="button" disabled={busy} onClick={onRemove} className="text-sm text-fg-muted hover:text-fg">
            Remover
          </button>
        )}
        <input ref={input} type="file" accept={ACCEPT} hidden aria-label={`Arquivo de ${label.toLowerCase()}`} onChange={onPick} />
      </div>
    </div>
  )
}
