import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { Hint, WordSearchPuzzle } from '../../lib/daily'
import { t } from '../../lib/i18n'

/** A Caça-palavras in progress: where each word was found (null: not yet) and in what order. */
export interface WordSearchProgress {
  found: ([number, number] | null)[]
  order: number[]
}

/** One color per found word, in the order they were found (theme tokens; it cycles past 8). */
export const WORD_COLORS = ['bg-game-1/45', 'bg-game-2/45', 'bg-game-3/45', 'bg-game-4/45', 'bg-game-5/45', 'bg-game-6/45', 'bg-game-7/45', 'bg-game-8/45']

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
  solved,
  hint,
  saved,
  onProgress
}: {
  puzzle: WordSearchPuzzle
  disabled: boolean
  onFilled(pairs: [number, number][]): void
  /** The words as found, shown read-only ("Ver jogo"). */
  solved?: [number, number][]
  /** The latest hint: where a word not found yet begins, marked until it's found. */
  hint?: Hint | null
  /** Where it was left (closing the game keeps it). */
  saved?: WordSearchProgress | null
  /** The words found and their order: kept for later, and sent when asking a hint. */
  onProgress?(progress: WordSearchProgress): void
}): ReactNode {
  const { size, rows, words, theme } = puzzle
  const letters = rows.join('')
  const [found, setFound] = useState<([number, number] | null)[]>(() => solved ?? (saved?.found.length === words.length ? saved.found : words.map(() => null)))
  // The order the words were found in: each gets the next color.
  const [order, setOrder] = useState<number[]>(() => (solved ? words.map((_, i) => i) : (saved?.order ?? [])))
  const [nudge, setNudge] = useState<{ word: number; cell: number } | null>(null)
  useEffect(() => onProgress?.({ found, order }), [found, order])
  useEffect(() => {
    if (hint?.word !== undefined && !solved) setNudge({ word: hint.word, cell: hint.cell })
  }, [hint?.n])
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
    setOrder((o) => [...o, index])
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

  // Each cell takes the color of the last word found through it.
  const colorOf = new Map<number, string>()
  order.forEach((word, k) => {
    const pair = found[word]
    for (const i of pair ? (lineBetween(size, pair[0], pair[1]) ?? []) : []) colorOf.set(i, WORD_COLORS[k % WORD_COLORS.length])
  })
  const nudged = nudge && !found[nudge.word] ? nudge.cell : null
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
              selected.has(i) ? 'bg-accent text-on-accent' : colorOf.has(i) ? `${colorOf.get(i)} text-fg` : 'text-fg'
            } ${nudged === i ? 'animate-pulse ring-2 ring-inset ring-success' : ''
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
