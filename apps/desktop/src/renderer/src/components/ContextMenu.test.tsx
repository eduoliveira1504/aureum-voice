/** Block 4.1.1: what the menu host shows (menus, the dialogs they open) stacks over any modal,
 * although the host is mounted before the modals (AppShell). */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { isAbove } from '../test/layers'
import { ContextMenuHost, Item, openMenuAt, showDialog } from './ContextMenu'
import { Modal } from './Modal'

function settingsWithMenu(onClose = vi.fn()): void {
  render(
    <>
      <ContextMenuHost />
      <Modal title="Configurações" onClose={onClose}>
        <button
          type="button"
          onClick={(e) =>
            openMenuAt(e.currentTarget, () => (
              <Item label="Apelido" onClick={() => showDialog((close) => <Modal title="Alterar apelido" onClose={close}>…</Modal>)} />
            ))
          }
        >
          Mais
        </button>
      </Modal>
    </>
  )
}

describe('menu host over modals', () => {
  it('a dialog opened from a menu inside a modal opens over that modal', () => {
    settingsWithMenu()
    fireEvent.click(screen.getByText('Mais'))
    fireEvent.click(screen.getByText('Apelido'))
    expect(isAbove(screen.getByRole('dialog', { name: 'Alterar apelido' }), screen.getByRole('dialog', { name: 'Configurações' }))).toBe(true)
  })

  it('a menu opened from that dialog goes over it', () => {
    settingsWithMenu()
    fireEvent.click(screen.getByText('Mais'))
    fireEvent.click(screen.getByText('Apelido'))
    act(() => openMenuAt(document.body, () => <Item label="Copiar" onClick={() => {}} />))
    expect(isAbove(screen.getByRole('menu'), screen.getByRole('dialog', { name: 'Alterar apelido' }))).toBe(true)
  })

  it('Escape with a menu open closes only the menu', () => {
    const onClose = vi.fn()
    settingsWithMenu(onClose)
    fireEvent.click(screen.getByText('Mais'))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
