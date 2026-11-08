/** The cameras widget's edit bar and the edit handle (Ctrl+Shift+F10). */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_WIDGETS } from '../../../shared/overlayWidgets'
import { CameraEditBar, tileWidthAfterDrag } from './OverlayCameras'

describe('tileWidthAfterDrag', () => {
  it('shares a drag across the columns', () => {
    expect(tileWidthAfterDrag(160, { x: 60, y: 0 }, 1, 3)).toBe(220)
    expect(tileWidthAfterDrag(160, { x: 60, y: 0 }, 3, 1)).toBe(180)
  })

  it('a drag down grows the cameras by their height, shared by the rows', () => {
    // 90 px down over one row is 160 px more width at 16:9.
    expect(tileWidthAfterDrag(160, { x: 0, y: 90 }, 1, 1)).toBe(320)
    expect(tileWidthAfterDrag(160, { x: 0, y: 90 }, 1, 3)).toBe(213)
  })

  it('follows whichever way moved more, and shrinks too', () => {
    expect(tileWidthAfterDrag(200, { x: -40, y: 5 }, 1, 1)).toBe(160)
  })

  it('stays between the smallest and the largest camera', () => {
    expect(tileWidthAfterDrag(160, { x: -500, y: 0 }, 1, 1)).toBe(96)
    expect(tileWidthAfterDrag(160, { x: 900, y: 0 }, 1, 1)).toBe(360)
  })
})

describe('CameraEditBar', () => {
  const prefs = { ...DEFAULT_WIDGETS.cameras, maxVisible: 3 }

  it('switches the format and changes how many show', () => {
    const set = vi.fn()
    render(<CameraEditBar prefs={prefs} set={set} />)
    fireEvent.click(screen.getByLabelText('Formato: Horizontal'))
    expect(set).toHaveBeenLastCalledWith({ layout: 'horizontal' })
    fireEvent.click(screen.getByLabelText('Câmeras visíveis: mais'))
    expect(set).toHaveBeenLastCalledWith({ maxVisible: 4 })
    fireEvent.click(screen.getByLabelText('Câmeras visíveis: menos'))
    expect(set).toHaveBeenLastCalledWith({ maxVisible: 2 })
    expect(screen.getByLabelText('Formato: Vertical').getAttribute('aria-pressed')).toBe('true')
  })

  it('stops at 1 and 8 cameras', () => {
    const { rerender } = render(<CameraEditBar prefs={{ ...prefs, maxVisible: 1 }} set={() => {}} />)
    expect(screen.getByLabelText('Câmeras visíveis: menos')).toHaveProperty('disabled', true)
    rerender(<CameraEditBar prefs={{ ...prefs, maxVisible: 8 }} set={() => {}} />)
    expect(screen.getByLabelText('Câmeras visíveis: mais')).toHaveProperty('disabled', true)
  })

  it('asks how many per row only in the grid', () => {
    const set = vi.fn()
    const { rerender } = render(<CameraEditBar prefs={prefs} set={set} />)
    expect(screen.queryByLabelText('Por linha: mais')).toBeNull()
    rerender(<CameraEditBar prefs={{ ...prefs, layout: 'grid', perRow: 2 }} set={set} />)
    fireEvent.click(screen.getByLabelText('Por linha: mais'))
    expect(set).toHaveBeenLastCalledWith({ perRow: 3 })
  })
})
