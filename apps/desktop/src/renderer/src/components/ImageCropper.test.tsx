/** Picking an image opens the crop editor; saving sends the original with the crop, and
 * "Ajustar posição" re-crops the kept original without uploading it. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import { CroppedImageRow } from './ImageCropper'
import { Modal } from './Modal'

// jsdom loads no images: every image is 400x200 and "loads" as soon as it gets a src.
class FakeImage {
  naturalWidth = 400
  naturalHeight = 200
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_: string) {
    queueMicrotask(() => this.onload?.())
  }
}

describe('CroppedImageRow', () => {
  let call: ReturnType<typeof vi.spyOn>
  const onDone = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('Image', FakeImage)
    URL.createObjectURL = vi.fn(() => 'blob:picked')
    URL.revokeObjectURL = vi.fn()
    call = vi.spyOn(api, 'api').mockResolvedValue({ id: 'me' })
    onDone.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uploads the picked file with the crop', async () => {
    render(<CroppedImageRow label="Avatar" shape="avatar" path="/users/me/avatar" hasImage={false} crop={null} name="Ana" onDone={onDone} />)
    const file = new File(['gif'], 'cat.gif', { type: 'image/gif' })
    fireEvent.change(screen.getByLabelText('Arquivo de avatar'), { target: { files: [file] } })
    await act(async () => {})
    expect(screen.getByRole('dialog', { name: 'Ajustar imagem' })).toBeTruthy()
    expect(screen.getByText('Ao lado do nome')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '2' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' })))

    const [path, options] = call.mock.calls[0] as [string, { method: string; body: FormData }]
    expect(path).toBe('/users/me/avatar')
    expect(options.method).toBe('POST')
    expect(options.body.get('file')).toBeInstanceOf(File)
    // 400x200 in a round 280 frame at 2x: the middle 100x100.
    expect(JSON.parse(options.body.get('crop') as string)).toEqual({ x: 150, y: 50, width: 100, height: 100, rotate: 0 })
    expect(onDone).toHaveBeenCalledWith({ id: 'me' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('adjusts the kept original', async () => {
    const fetchMedia = vi.spyOn(api, 'fetchMedia').mockResolvedValue(new Blob(['png']))
    const saved = { x: 0, y: 0, width: 200, height: 200, rotate: 0 }
    render(<CroppedImageRow label="Ícone" shape="icon" path="/servers/s1/icon" hasImage crop={saved} name="Squad" onDone={onDone} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ajustar posição' })))
    expect(fetchMedia).toHaveBeenCalledWith('/api/servers/s1/icon/original')

    fireEvent.click(screen.getByRole('button', { name: /Girar 90/ }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' })))
    expect(call).toHaveBeenCalledWith('/servers/s1/icon/crop', { method: 'PUT', body: { x: 0, y: 0, width: 200, height: 200, rotate: 90 } })
  })

  it('has no "Ajustar posição" for images uploaded before the editor', () => {
    render(<CroppedImageRow label="Banner" shape="banner" path="/users/me/banner" hasImage crop={null} name="Ana" onDone={onDone} />)
    expect(screen.queryByRole('button', { name: 'Ajustar posição' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remover' })).toBeTruthy()
  })

  it('Escape closes only the editor, not the settings under it', async () => {
    const closeSettings = vi.fn()
    render(
      <Modal title="Configurações" onClose={closeSettings}>
        <CroppedImageRow label="Avatar" shape="avatar" path="/users/me/avatar" hasImage={false} crop={null} name="Ana" onDone={onDone} />
      </Modal>
    )
    fireEvent.change(screen.getByLabelText('Arquivo de avatar'), { target: { files: [new File(['x'], 'x.png')] } })
    await act(async () => {})
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Ajustar imagem' })).toBeNull()
    expect(closeSettings).not.toHaveBeenCalled()
  })
})
