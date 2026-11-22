import { Eraser } from 'lucide-react'
import { useState, type KeyboardEvent, type ReactNode } from 'react'

import { sudokuConflicts, type SudokuPuzzle } from '../../lib/daily'
import { t } from '../../lib/i18n'

/**
 * The Sudoku grid: click a cell (or move with the arrows) and type 1–9, Backspace or 0 erases.
 * Repeated numbers show in red. Once every cell is filled without repeats, `onFilled` gets the grid
 * for the API to check.
 */
export function SudokuBoard({
  puzzle,
  disabled,
  onFilled,
  solved
}: {
  puzzle: SudokuPuzzle
  disabled: boolean
  onFilled(cells: number[]): void
  /** A finished grid, shown read-only ("Ver jogo"). */
  solved?: number[]
}): ReactNode {
  const [cells, setCells] = useState<number[]>(() => solved ?? [...puzzle.givens])
  const [selected, setSelected] = useState<number | null>(() => (solved ? null : puzzle.givens.indexOf(0)))
  const conflicts = sudokuConflicts(cells)
  const fixed = (i: number): boolean => puzzle.givens[i] !== 0

  const put = (value: number): void => {
    if (disabled || solved || selected === null || fixed(selected)) return
    const next = [...cells]
    next[selected] = value
    setCells(next)
    if (value && next.every(Boolean) && sudokuConflicts(next).size === 0) onFilled(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (/^[1-9]$/.test(e.key)) put(Number(e.key))
    else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') put(0)
    else if (e.key.startsWith('Arrow') && selected !== null) {
      const r = Math.floor(selected / 9)
      const c = selected % 9
      const [dr, dc] = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key] ?? [0, 0]
      setSelected(((r + dr + 9) % 9) * 9 + ((c + dc + 9) % 9))
    } else return
    e.preventDefault()
  }

  const value = selected !== null ? cells[selected] : 0
  const related = (i: number): boolean => {
    if (selected === null) return false
    const same = (a: number, b: number): boolean => Math.floor(a / 27) === Math.floor(b / 27) && Math.floor((a % 9) / 3) === Math.floor((b % 9) / 3)
    return Math.floor(i / 9) === Math.floor(selected / 9) || i % 9 === selected % 9 || same(i, selected)
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        role="grid"
        aria-label={t('games.games.sudoku.name')}
        tabIndex={0}
        autoFocus={!solved}
        onKeyDown={onKeyDown}
        className="grid aspect-square w-full max-w-[420px] grid-cols-9 overflow-hidden rounded-control border-2 border-fg-subtle bg-main outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {cells.map((v, i) => {
          const r = Math.floor(i / 9)
          const c = i % 9
          const box = `${c % 3 === 2 && c < 8 ? 'border-r-2 border-r-fg-subtle' : c < 8 ? 'border-r border-r-line' : ''} ${
            r % 3 === 2 && r < 8 ? 'border-b-2 border-b-fg-subtle' : r < 8 ? 'border-b border-b-line' : ''
          }`
          const tone = conflicts.has(i) ? 'text-danger' : fixed(i) ? 'text-fg font-semibold' : 'text-accent-text'
          const back = i === selected ? 'bg-accent/25' : value && v === value ? 'bg-accent/10' : related(i) ? 'bg-elevated' : ''
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              aria-label={`${t('games.games.sudoku.cell', { row: r + 1, col: c + 1 })}${v ? `: ${v}` : ''}`}
              aria-selected={i === selected}
              tabIndex={-1}
              onClick={() => setSelected(i)}
              className={`flex items-center justify-center text-lg tabular-nums ${box} ${tone} ${back}`}
            >
              {v || ''}
            </button>
          )
        })}
      </div>
      <div className={`flex flex-wrap justify-center gap-1.5 ${solved ? 'hidden' : ''}`}>
        {Array.from({ length: 9 }, (_, n) => n + 1).map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            aria-label={t('games.games.sudoku.number', { n })}
            onClick={() => put(n)}
            className="h-10 w-10 rounded-control border border-line bg-main text-lg font-semibold tabular-nums hover:bg-elevated disabled:opacity-50"
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          title={t('games.games.sudoku.erase')}
          aria-label={t('games.games.sudoku.erase')}
          onClick={() => put(0)}
          className="flex h-10 w-10 items-center justify-center rounded-control border border-line bg-main text-fg-muted hover:bg-elevated disabled:opacity-50"
        >
          <Eraser size={18} />
        </button>
      </div>
    </div>
  )
}
