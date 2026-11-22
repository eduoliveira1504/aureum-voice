/** Block 4.2.10: drawing the Trilha path. A 3×3 grid: 1 top left, 2 bottom right, a wall 4|7. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { TrilhaPuzzle } from '../../lib/daily'
import { TrilhaBoard } from './TrilhaBoard'

// 0 1 2      the only way: 0 1 2 5 4 3 6 7 8
// 3 4 5
// 6 7 8
const PUZZLE: TrilhaPuzzle = { size: 3, numbers: [1, 0, 0, 0, 0, 0, 0, 0, 2], walls: [[4, 7]] }
const PATH = [0, 1, 2, 5, 4, 3, 6, 7, 8]
const cell = (i: number): HTMLElement => document.querySelector(`[data-cell="${i}"]`) as HTMLElement
const onPath = (): number[] => [...document.querySelectorAll('[aria-selected="true"]')].map((el) => Number((el as HTMLElement).dataset.cell))
const drag = (cells: number[]): void => {
  fireEvent.pointerDown(cell(cells[0]))
  for (const i of cells.slice(1)) fireEvent.pointerEnter(cell(i))
  fireEvent.pointerUp(window)
}

describe('Trilha board', () => {
  it('draws the path by dragging from 1 and hands it over once it covers every cell', () => {
    const onFilled = vi.fn()
    render(<TrilhaBoard puzzle={PUZZLE} disabled={false} onFilled={onFilled} />)
    drag(PATH)
    expect(onFilled).toHaveBeenCalledWith(PATH)
  })

  it("won't cross a wall, take the last number early, or skip a cell", () => {
    const onFilled = vi.fn()
    render(<TrilhaBoard puzzle={PUZZLE} disabled={false} onFilled={onFilled} />)
    drag([0, 1, 4, 7]) // 4|7 is a wall
    expect(onPath()).toEqual([0, 1, 4])
    drag([4, 5, 8]) // 2 has to be the last cell
    expect(onPath()).toEqual([0, 1, 4, 5])
    drag([5, 3]) // not a neighbor
    expect(onPath()).toEqual([0, 1, 4, 5])
    expect(onFilled).not.toHaveBeenCalled()
  })

  it('going back over the last cell undoes it, and clicking the path cuts it there', () => {
    render(<TrilhaBoard puzzle={PUZZLE} disabled={false} onFilled={() => {}} />)
    drag([0, 1, 2, 5, 2])
    expect(onPath()).toEqual([0, 1, 2])
    drag([2, 5, 4, 3])
    fireEvent.pointerDown(cell(1))
    expect(onPath()).toEqual([0, 1])
    fireEvent.click(screen.getByRole('button', { name: 'Recomeçar' }))
    expect(onPath()).toEqual([0])
  })

  it('also plays with the arrows', () => {
    const onFilled = vi.fn()
    render(<TrilhaBoard puzzle={PUZZLE} disabled={false} onFilled={onFilled} />)
    const grid = screen.getByRole('grid')
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowRight']) fireEvent.keyDown(grid, { key })
    expect(onFilled).toHaveBeenCalledWith(PATH)
  })
})
