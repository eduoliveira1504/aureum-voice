import { RotateCcw, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import type { Hint, TrilhaPuzzle } from '../../lib/daily'
import { t } from '../../lib/i18n'

/** A Trilha in progress: the path drawn so far. */
export interface TrilhaProgress {
  path: number[]
}

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

/** Where a wall between two neighboring cells sits: the shared edge, in cell units. */
function wallLine(size: number, a: number, b: number): { x1: number; y1: number; x2: number; y2: number } {
  const first = Math.min(a, b)
  const r = Math.floor(first / size)
  const c = first % size
  return Math.abs(a - b) === 1 ? { x1: c + 1, y1: r, x2: c + 1, y2: r + 1 } : { x1: c, y1: r + 1, x2: c + 1, y2: r + 1 }
}

/**
 * Trilha: drag from 1 (or use the arrows) to draw the path; going back over the last cell undoes
 * it, clicking a cell of the path cuts it there. Walls and numbers out of order can't be crossed.
 * Once the path goes through every cell, `onFilled` gets it for the API to check.
 *
 * Drawn as one SVG (block 4.2.10 fix): every cell the same size, walls on the edge between two
 * cells, the path through the cells' centers. `solved` shows a finished path, read-only.
 */
export function TrilhaBoard({
  puzzle,
  disabled,
  onFilled,
  solved,
  hint,
  saved,
  onProgress
}: {
  puzzle: TrilhaPuzzle
  disabled: boolean
  onFilled(path: number[]): void
  solved?: number[]
  /** The latest hint: the path back to where it was right, and the next cell marked. */
  hint?: Hint | null
  /** Where it was left (closing the game keeps it). */
  saved?: TrilhaProgress | null
  /** The path as it is: kept for later, and sent when asking a hint. */
  onProgress?(progress: TrilhaProgress): void
}): ReactNode {
  const { size, numbers, walls } = puzzle
  const cells = size * size
  const start = numbers.indexOf(1)
  const last = Math.max(...numbers)
  const open = useMemo(() => openNeighbors(size, walls), [size, walls])
  const [path, setPath] = useState<number[]>(() => solved ?? (saved?.path[0] === start ? saved.path : [start]))
  // The hinted next cell, marked until the path reaches it.
  const [nudge, setNudge] = useState<number | null>(null)
  useEffect(() => onProgress?.({ path }), [path])
  useEffect(() => {
    if (!hint || hint.keep === undefined || solved) return
    setPath((p) => p.slice(0, hint.keep))
    setNudge(hint.cell)
  }, [hint?.n])
  const nudged = nudge !== null && !path.includes(nudge) ? nudge : null
  const dragging = useRef(false)
  const board = useRef<SVGSVGElement>(null)
  const readOnly = disabled || !!solved

  useEffect(() => {
    if (!solved) board.current?.focus()
  }, [solved])

  useEffect(() => {
    const stop = (): void => void (dragging.current = false)
    window.addEventListener('pointerup', stop)
    return () => window.removeEventListener('pointerup', stop)
  }, [])

  /** The number the path has to meet next. */
  const expected = (p: number[]): number => Math.max(...p.map((i) => numbers[i])) + 1

  const extend = (cell: number): void => {
    if (readOnly) return
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
    if (readOnly) return
    setPath((p) => (p.includes(cell) ? p.slice(0, p.indexOf(cell) + 1) : p))
  }

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>): void => {
    const end = path[path.length - 1]
    const step = { ArrowUp: -size, ArrowDown: size, ArrowLeft: -1, ArrowRight: 1 }[e.key]
    if (step !== undefined) {
      const target = end + step
      const sameRow = Math.abs(step) !== 1 || Math.floor(target / size) === Math.floor(end / size)
      if (target >= 0 && target < cells && sameRow) extend(target)
    } else if (e.key === 'Backspace' && !readOnly) setPath((p) => (p.length > 1 ? p.slice(0, -1) : p))
    else return
    e.preventDefault()
  }

  const x = (i: number): number => (i % size) + 0.5
  const y = (i: number): number => Math.floor(i / size) + 0.5
  const lines = Array.from({ length: size - 1 }, (_, k) => k + 1)

  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        role="grid"
        aria-label={t('games.games.trilha.name')}
        ref={board}
        tabIndex={0}
        onKeyDown={onKeyDown}
        viewBox={`-0.06 -0.06 ${size + 0.12} ${size + 0.12}`}
        className="aspect-square w-full max-w-[420px] touch-none select-none rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <rect x={0} y={0} width={size} height={size} rx={0.12} className="fill-main" />
        {/* Every cell: tinted once the path goes through it, and where the pointer lands. */}
        {Array.from({ length: cells }, (_, i) => (
          <rect
            key={i}
            role="gridcell"
            data-cell={i}
            aria-label={`${t('games.games.trilha.cell', { row: Math.floor(i / size) + 1, col: (i % size) + 1 })}${numbers[i] ? `: ${numbers[i]}` : ''}`}
            aria-selected={path.includes(i)}
            x={i % size}
            y={Math.floor(i / size)}
            width={1}
            height={1}
            className={path.includes(i) ? 'fill-accent/15' : 'fill-transparent'}
            onPointerDown={(e) => {
              e.preventDefault()
              dragging.current = true
              if (path.includes(i)) cut(i)
              else extend(i)
            }}
            onPointerEnter={() => dragging.current && extend(i)}
          />
        ))}
        <g className="pointer-events-none">
          {lines.map((k) => (
            <g key={k} className="stroke-line" strokeWidth={0.02}>
              <line x1={k} y1={0} x2={k} y2={size} />
              <line x1={0} y1={k} x2={size} y2={k} />
            </g>
          ))}
          <rect x={0} y={0} width={size} height={size} rx={0.12} fill="none" className="stroke-fg-subtle" strokeWidth={0.06} />
          {path.length > 1 && (
            <polyline
              points={path.map((i) => `${x(i)},${y(i)}`).join(' ')}
              fill="none"
              className="stroke-accent"
              strokeWidth={0.34}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.75}
            />
          )}
          {nudged !== null && (
            <rect
              data-hint-cell={nudged}
              x={(nudged % size) + 0.1}
              y={Math.floor(nudged / size) + 0.1}
              width={0.8}
              height={0.8}
              rx={0.15}
              className="animate-pulse fill-success/30 stroke-success"
              strokeWidth={0.06}
            />
          )}
          {walls.map(([a, b]) => (
            <line key={`${a}-${b}`} {...wallLine(size, a, b)} className="stroke-fg" strokeWidth={0.12} strokeLinecap="round" />
          ))}
          {numbers.map((n, i) =>
            n ? (
              <g key={i}>
                <circle cx={x(i)} cy={y(i)} r={0.3} className={path.includes(i) ? 'fill-accent' : 'fill-fg'} />
                <text x={x(i)} y={y(i)} dy="0.12em" textAnchor="middle" fontSize={0.34} fontWeight={700} className={path.includes(i) ? 'fill-on-accent' : 'fill-main'}>
                  {n}
                </text>
              </g>
            ) : null
          )}
        </g>
      </svg>
      {!solved && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={readOnly || path.length < 2}
            onClick={() => setPath((p) => p.slice(0, -1))}
            className="flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-elevated hover:text-fg disabled:opacity-50"
          >
            <Undo2 size={16} />
            {t('games.games.trilha.undo')}
          </button>
          <button
            type="button"
            disabled={readOnly || path.length < 2}
            onClick={() => setPath([start])}
            className="flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-elevated hover:text-fg disabled:opacity-50"
          >
            <RotateCcw size={16} />
            {t('games.games.trilha.restart')}
          </button>
        </div>
      )}
    </div>
  )
}
