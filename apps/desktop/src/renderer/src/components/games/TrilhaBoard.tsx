import { RotateCcw, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import type { TrilhaPuzzle } from '../../lib/daily'
import { t } from '../../lib/i18n'

/** Cells a step can go to from `i`: up, down, left, right, minus the walls. */
function openNeighbors(size: number, walls: [number, number][]): number[][] {
  const blocked = new Set(walls.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`))
  return Array.from({ length: size * size }, (_, i) => {
    const r = Math.floor(i / size)
    const c = i % size
    const near = [r > 0 && i - size, r < size - 1 && i + size, c > 0 && i - 1, c < size - 1 && i + 1].filter((n): n is number => n !== false)
    return near.filter((n) => !blocked.has(`${Math.min(i, n)}-${Math.max(i, n)}`))
  })
}

/**
 * Trilha: drag from 1 (or use the arrows) to draw the path; going back over the last cell undoes
 * it, clicking a cell of the path cuts it there. Walls and numbers out of order can't be crossed.
 * Once the path goes through every cell, `onFilled` gets it for the API to check.
 */
export function TrilhaBoard({ puzzle, disabled, onFilled }: { puzzle: TrilhaPuzzle; disabled: boolean; onFilled(path: number[]): void }): ReactNode {
  const { size, numbers, walls } = puzzle
  const cells = size * size
  const start = numbers.indexOf(1)
  const last = Math.max(...numbers)
  const open = useMemo(() => openNeighbors(size, walls), [size, walls])
  const [path, setPath] = useState<number[]>([start])
  const dragging = useRef(false)

  useEffect(() => {
    const stop = (): void => void (dragging.current = false)
    window.addEventListener('pointerup', stop)
    return () => window.removeEventListener('pointerup', stop)
  }, [])

  /** The number the path has to meet next. */
  const expected = (p: number[]): number => Math.max(...p.map((i) => numbers[i])) + 1

  const extend = (cell: number): void => {
    if (disabled) return
    const end = path[path.length - 1]
    if (path.length > 1 && cell === path[path.length - 2]) return setPath(path.slice(0, -1)) // back over the last step
    if (path.includes(cell) || !open[end].includes(cell)) return
    const n = numbers[cell]
    if (n && n !== expected(path)) return
    if (n === last && path.length + 1 < cells) return // the highest number ends the path
    const next = [...path, cell]
    setPath(next)
    if (next.length === cells) onFilled(next)
  }
  const cut = (cell: number): void => {
    if (disabled) return
    setPath((p) => (p.includes(cell) ? p.slice(0, p.indexOf(cell) + 1) : p))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const end = path[path.length - 1]
    const step = { ArrowUp: -size, ArrowDown: size, ArrowLeft: -1, ArrowRight: 1 }[e.key]
    if (step !== undefined) {
      const target = end + step
      const sameRow = Math.abs(step) !== 1 || Math.floor(target / size) === Math.floor(end / size)
      if (target >= 0 && target < cells && sameRow) extend(target)
    } else if (e.key === 'Backspace') setPath((p) => (p.length > 1 ? p.slice(0, -1) : p))
    else return
    e.preventDefault()
  }

  const center = (i: number): string => `${(i % size) + 0.5},${Math.floor(i / size) + 0.5}`
  const wallRight = (i: number): boolean => i % size < size - 1 && !open[i].includes(i + 1)
  const wallDown = (i: number): boolean => i + size < cells && !open[i].includes(i + size)

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        role="grid"
        aria-label={t('games.games.trilha.name')}
        tabIndex={0}
        autoFocus
        onKeyDown={onKeyDown}
        className="relative grid aspect-square w-full max-w-[420px] touch-none select-none overflow-hidden rounded-control border-2 border-fg-subtle bg-main outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
      >
        <svg aria-hidden viewBox={`0 0 ${size} ${size}`} className="pointer-events-none absolute inset-0 h-full w-full">
          <polyline points={path.map(center).join(' ')} fill="none" className="stroke-accent" strokeWidth={0.32} strokeLinecap="round" strokeLinejoin="round" opacity={0.55} />
        </svg>
        {Array.from({ length: cells }, (_, i) => {
          const r = Math.floor(i / size)
          const c = i % size
          const onPath = path.includes(i)
          const n = numbers[i]
          return (
            <div
              key={i}
              role="gridcell"
              aria-label={`${t('games.games.trilha.cell', { row: r + 1, col: c + 1 })}${n ? `: ${n}` : ''}`}
              aria-selected={onPath}
              data-cell={i}
              onPointerDown={(e) => {
                e.preventDefault()
                dragging.current = true
                if (onPath) cut(i)
                else extend(i)
              }}
              onPointerEnter={() => dragging.current && extend(i)}
              className={`relative flex items-center justify-center ${wallRight(i) ? 'border-r-4 border-r-fg' : c < size - 1 ? 'border-r border-r-line' : ''} ${
                wallDown(i) ? 'border-b-4 border-b-fg' : r < size - 1 ? 'border-b border-b-line' : ''
              } ${onPath ? 'bg-accent/15' : ''}`}
            >
              {n > 0 && (
                <span className={`relative z-raised flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${onPath ? 'bg-accent text-on-accent' : 'bg-fg text-main'}`}>
                  {n}
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled || path.length < 2}
          onClick={() => setPath((p) => p.slice(0, -1))}
          className="flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-elevated hover:text-fg disabled:opacity-50"
        >
          <Undo2 size={16} />
          {t('games.games.trilha.undo')}
        </button>
        <button
          type="button"
          disabled={disabled || path.length < 2}
          onClick={() => setPath([start])}
          className="flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-elevated hover:text-fg disabled:opacity-50"
        >
          <RotateCcw size={16} />
          {t('games.games.trilha.restart')}
        </button>
      </div>
    </div>
  )
}
