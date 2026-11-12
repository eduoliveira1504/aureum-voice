import { useState, type PointerEvent, type ReactNode } from 'react'

import { useAppearance } from '../store/appearance'

export interface ColumnSpec {
  /** Key in the user's column_sizes setting. */
  key: string
  initial: number
  min: number
  max: number
}

export const COLUMNS = {
  sidebar: { key: 'sidebar', initial: 240, min: 200, max: 400 },
  members: { key: 'members', initial: 240, min: 200, max: 420 },
  overviewSide: { key: 'overview.side', initial: 288, min: 220, max: 480 },
  callChat: { key: 'call.chat', initial: 360, min: 260, max: 640 }
} satisfies Record<string, ColumnSpec>

const clamp = (spec: ColumnSpec, width: number): number => Math.round(Math.min(spec.max, Math.max(spec.min, width)))

/** A column's width saved in the user's column_sizes, and the handle that resizes it. */
export function useColumnWidth(spec: ColumnSpec, edge: 'left' | 'right'): { width: number; handle: ReactNode } {
  const saved = useAppearance((s) => s.settings.column_sizes[spec.key])
  return useResizable(spec, edge, saved, (width) => useAppearance.getState().updateEntry('column_sizes', spec.key, width))
}

/**
 * A resizable column: its width and the handle, with the saving left to the caller. `edge` is the
 * side of the column the handle sits on: dragging it away from the column makes the column wider.
 * Double click clears the saved width.
 */
export function useResizable(
  spec: ColumnSpec,
  edge: 'left' | 'right',
  saved: number | null | undefined,
  save: (width: number | null) => void
): { width: number; handle: ReactNode } {
  const [live, setLive] = useState<number | null>(null)
  const width = live ?? clamp(spec, saved ?? spec.initial)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startWidth = width
    const at = (x: number): number => clamp(spec, startWidth + (edge === 'right' ? x - startX : startX - x))
    const move = (ev: globalThis.PointerEvent): void => setLive(at(ev.clientX))
    const up = (ev: globalThis.PointerEvent): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setLive(null)
      save(at(ev.clientX))
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const handle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionar coluna"
      aria-valuenow={width}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      onPointerDown={onPointerDown}
      onDoubleClick={() => save(null)}
      className={`group absolute inset-y-0 z-raised w-2 cursor-col-resize ${edge === 'right' ? '-right-1' : '-left-1'}`}
    >
      <span className={`absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors ${live !== null ? 'bg-accent' : 'group-hover:bg-accent/60'}`} />
    </div>
  )
  return { width, handle }
}
