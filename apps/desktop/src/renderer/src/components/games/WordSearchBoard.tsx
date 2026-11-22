import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { WordSearchPuzzle } from '../../lib/daily'
import { t } from '../../lib/i18n'

/** As in the grid: capitals, no accents, Ç as C (the API's plain()). */
export const plainWord = (word: string): string => word.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()

/** The cells from `a` to `b` if they make a straight line (row, column or diagonal). */
export function lineBetween(size: number, a: number, b: number): number[] | null {
  const [r1, c1, r2, c2] = [Math.floor(a / size), a % size, Math.floor(b / size), b % size]
  const dr = Math.sign(r2 - r1)
  const dc = Math.sign(c2 - c1)
  const steps = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1))
  if (r1 !== r2 && c1 !== c2 && Math.abs(r2 - r1) !== Math.abs(c2 - c1)) return null
  return Array.from({ length: steps + 1 }, (_, k) => (r1 + dr * k) * size + c1 + dc * k)
}

/**
 * Caça-palavras: drag from a word's first letter to its last (any of the 8 directions), or click
 * one end and then the other. A found word is crossed out in the list. Once all are found,
 * `onFilled` gets [first, last] for each word, in the list's order.
 */
export function WordSearchBoard({
  puzzle,
  disabled,
  onFilled,
  solved
}: {
  puzzle: WordSearchPuzzle
  disabled: boolean
  onFilled(pairs: [number, number][]): void
  /** The words as found, shown read-only ("Ver jogo"). */
  solved?: [number, number][]
}): ReactNode {
  const { size, rows, words, theme } = puzzle
  const letters = rows.join('')
  const [found, setFound] = useState<([number, number] | null)[]>(() => solved ?? words.map(() => null))
  const [start, setStart] = useState<number | null>(null)
  const [end, setEnd] = useState<number | null>(null)
  const dragging = useRef(false)

  const selection = start !== null && end !== null ? lineBetween(size, start, end) : start !== null ? [start] : null

  const finish = (from: number, to: number): void => {
    const cells = lineBetween(size, from, to)
    setStart(null)
    setEnd(null)
    if (!cells || cells.length < 2) return
    const read = cells.map((i) => letters[i]).join('')
    const index = words.findIndex((w, i) => !found[i] && (plainWord(w) === read || plainWord(w) === [...read].reverse().join('')))
    if (index < 0) return
    const next = [...found]
    next[index] = [from, to]
    setFound(next)
    if (next.every(Boolean)) onFilled(next as [number, number][])
  }

  useEffect(() => {
    const up = (): void => {
      if (!dragging.current) return
      dragging.current = false
      // A press without moving keeps the first letter chosen, for a click on the last one.
      if (start !== null && end !== null && end !== start) finish(start, end)
      else setEnd(null)
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  })

  const foundCells = new Set(found.flatMap((pair) => (pair ? (lineBetween(size, pair[0], pair[1]) ?? []) : [])))
  const selected = new Set(selection ?? [])

  return (
    <div className="flex w-full flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-center">
      <div
        role="grid"
        aria-label={t('games.games.cacapalavras.name')}
        className="grid aspect-square w-full max-w-[420px] touch-none select-none overflow-hidden rounded-control border-2 border-fg-subtle bg-main"
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
      >
        {[...letters].map((letter, i) => (
          <div
            key={i}
            role="gridcell"
            data-cell={i}
            aria-label={t('games.games.cacapalavras.cell', { row: Math.floor(i / size) + 1, col: (i % size) + 1, letter })}
            aria-selected={selected.has(i)}
            onPointerDown={(e) => {
              e.preventDefault()
              if (disabled || solved) return
              if (start !== null && end === null && start !== i) return finish(start, i) // second click
              dragging.current = true
              setStart(i)
              setEnd(i)
            }}
            onPointerEnter={() => dragging.current && setEnd(i)}
            className={`flex items-center justify-center font-display text-base font-semibold sm:text-lg ${
              selected.has(i) ? 'bg-accent text-on-accent' : foundCells.has(i) ? 'bg-accent/25 text-accent-text' : 'text-fg'
            }`}
          >
            {letter}
          </div>
        ))}
      </div>
      <div className="w-full max-w-[420px] sm:w-44">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{t('games.games.cacapalavras.theme', { theme })}</p>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-1">
          {words.map((word, i) => (
            <li key={word} className={`text-sm ${found[i] ? 'text-fg-subtle line-through' : 'font-medium'}`} aria-label={found[i] ? t('games.games.cacapalavras.foundWord', { word }) : word}>
              {word}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-fg-subtle">{t('games.games.cacapalavras.count', { found: found.filter(Boolean).length, total: words.length })}</p>
      </div>
    </div>
  )
}
