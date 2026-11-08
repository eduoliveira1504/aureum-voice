/** Call popovers open in the window their button is in: the app's, or the detached call window. */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { CallPopover } from './CallDeviceMenus'

function Opener(): ReactNode {
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen(true)}>
        Painel de sons
      </button>
      {open && (
        <CallPopover anchor={anchor} label="Painel de sons" onClose={() => setOpen(false)}>
          sons
        </CallPopover>
      )}
    </>
  )
}

describe('call popover', () => {
  afterEach(() => document.querySelectorAll('iframe').forEach((f) => f.remove()))

  it('opens in the app window for a button there', () => {
    render(<Opener />)
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Painel de sons' })))
    expect(screen.getByRole('dialog', { name: 'Painel de sons' })).toBeTruthy()
  })

  it('opens in the other window for a button in it, and closes on a click outside there', () => {
    const frame = document.createElement('iframe')
    document.documentElement.appendChild(frame)
    const other = frame.contentDocument as Document
    render(<>{createPortal(<Opener />, other.body)}</>)
    const inOther = within(other.body)
    act(() => fireEvent.click(inOther.getByRole('button', { name: 'Painel de sons' })))
    expect(inOther.getByRole('dialog', { name: 'Painel de sons' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Painel de sons' })).toBeNull()
    act(() => fireEvent.mouseDown(other.body))
    expect(inOther.queryByRole('dialog', { name: 'Painel de sons' })).toBeNull()
  })
})
