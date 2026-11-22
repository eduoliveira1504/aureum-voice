/** Block 4.2.10: finding words in the Caça-palavras grid. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { WordSearchPuzzle } from '../../lib/daily'
import { lineBetween, plainWord, WordSearchBoard } from './WordSearchBoard'

// G A T O      gato: 0→3   ·   maçã (MACA): 12→15 written backwards   ·   gema (GEMA): 0→12, down
// E X Y Z
// M Q W K
// A C A M
const PUZZLE: WordSearchPuzzle = { size: 4, theme: 'Teste', rows: ['GATO', 'EXYZ', 'MQWK', 'ACAM'], words: ['gato', 'gema', 'maçã'] }
const cell = (i: number): HTMLElement => document.querySelector(`[data-cell="${i}"]`) as HTMLElement
const drag = (from: number, ...through: number[]): void => {
  fireEvent.pointerDown(cell(from))
  for (const i of through) fireEvent.pointerEnter(cell(i))
  fireEvent.pointerUp(window)
}

describe('word search helpers', () => {
  it('reads words as the grid does', () => {
    expect(plainWord('maçã')).toBe('MACA')
    expect(plainWord('Pêssego')).toBe('PESSEGO')
  })

  it('takes only straight lines', () => {
    expect(lineBetween(4, 0, 3)).toEqual([0, 1, 2, 3])
    expect(lineBetween(4, 15, 0)).toEqual([15, 10, 5, 0])
    expect(lineBetween(4, 0, 6)).toBeNull()
  })
})

describe('Caça-palavras board', () => {
  it('finds words by dragging (backwards too) or by clicking both ends, then hands them over', () => {
    const onFilled = vi.fn()
    render(<WordSearchBoard puzzle={PUZZLE} disabled={false} onFilled={onFilled} />)
    drag(0, 1, 2, 3)
    expect(screen.getByLabelText('gato (achada)').className).toContain('line-through')
    drag(15, 14, 13, 12) // MACA, read right to left
    expect(screen.getByLabelText('maçã (achada)')).toBeTruthy()
    // Click the first letter, then the last.
    fireEvent.pointerDown(cell(0))
    fireEvent.pointerUp(window)
    fireEvent.pointerDown(cell(12))
    expect(onFilled).toHaveBeenCalledWith([
      [0, 3],
      [0, 12],
      [15, 12]
    ])
  })

  it('ignores a line that spells nothing, and a word found twice', () => {
    const onFilled = vi.fn()
    render(<WordSearchBoard puzzle={PUZZLE} disabled={false} onFilled={onFilled} />)
    drag(4, 5, 6, 7) // EXYZ
    drag(0, 5, 10, 15) // GXWM
    expect(screen.getByText('0 de 3')).toBeTruthy()
    drag(0, 1, 2, 3)
    drag(3, 2, 1, 0)
    expect(screen.getByText('1 de 3')).toBeTruthy()
    expect(onFilled).not.toHaveBeenCalled()
  })
})
