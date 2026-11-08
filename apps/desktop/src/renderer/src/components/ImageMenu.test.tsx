/** Right click on chat images (3.24 B): copy, save and open, over the message's own options. */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Attachment } from '../lib/api'
import { closeImages, useImageViewer } from '../lib/chatImages'
import { MessageAttachments } from './Attachments'
import { closeContextMenu, ContextMenuHost, Item } from './ContextMenu'
import { GifMessage } from './Gifs'
import { MessageMenuContext } from './ImageMenu'

const media = vi.hoisted(() => ({
  attachmentUrl: vi.fn(async (a: { id: string }) => `blob:aureum/${a.id}`),
  fetchMedia: vi.fn()
}))

vi.mock('../lib/attachments', () => ({
  useAttachmentUrl: (a: { id: string }) => ({ url: `blob:aureum/${a.id}`, failed: false }),
  attachmentUrl: media.attachmentUrl,
  downloadAttachment: vi.fn(),
  formatSize: (n: number) => `${n} B`
}))
vi.mock('../lib/api', async (original) => ({ ...(await original<object>()), fetchMedia: media.fetchMedia }))

const photo: Attachment = {
  id: '6f1c2a3b-0000-4000-8000-000000000001',
  filename: 'print da partida.png',
  kind: 'image',
  content_type: 'image/png',
  size: 100,
  url: '/api/media/attachments/6f1c2a3b-0000-4000-8000-000000000001'
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

const messageItems = (): React.ReactNode => <Item label="Copiar link da mensagem" onClick={() => {}} />

function renderInMessage(children: React.ReactNode): void {
  render(
    <>
      <MessageMenuContext.Provider value={messageItems}>{children}</MessageMenuContext.Provider>
      <ContextMenuHost />
    </>
  )
}

const labels = (): string[] => within(screen.getByRole('menu')).getAllByRole('button').map((item) => item.textContent ?? '')

describe('image menu', () => {
  const fetchSpy = vi.fn(async (url: string) => {
    if (!url.startsWith('blob:aureum/')) throw new Error(`unexpected fetch ${url}`)
    return { blob: async () => new Blob([PNG], { type: 'image/png' }) } as Response
  })

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchSpy)
    vi.mocked(window.aureum.images.copy).mockClear()
    vi.mocked(window.aureum.images.save).mockClear()
    fetchSpy.mockClear()
    media.fetchMedia.mockClear()
  })

  afterEach(() => {
    act(() => {
      closeContextMenu()
      closeImages()
    })
    vi.unstubAllGlobals()
  })

  it("puts the image's options above the message's", () => {
    renderInMessage(<MessageAttachments attachments={[photo]} own={false} />)
    fireEvent.contextMenu(screen.getByTitle(photo.filename))
    expect(labels()).toEqual(['Copiar imagem', 'Salvar imagem como…', 'Abrir imagem', 'Copiar link da mensagem'])
  })

  it('copies the bytes the app already loaded, as an image', async () => {
    renderInMessage(<MessageAttachments attachments={[photo]} own={false} />)
    fireEvent.contextMenu(screen.getByTitle(photo.filename))
    fireEvent.click(screen.getByText('Copiar imagem'))
    await waitFor(() => expect(window.aureum.images.copy).toHaveBeenCalledWith(PNG))
    // Through the attachment cache (same token and permission check as showing it), no other route.
    expect(media.attachmentUrl).toHaveBeenCalledWith(photo)
    expect(media.fetchMedia).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledWith(`blob:aureum/${photo.id}`)
  })

  it('saves with the original name and its type', async () => {
    renderInMessage(<MessageAttachments attachments={[photo]} own={false} />)
    fireEvent.contextMenu(screen.getByTitle(photo.filename))
    fireEvent.click(screen.getByText('Salvar imagem como…'))
    await waitFor(() => expect(window.aureum.images.save).toHaveBeenCalledWith(PNG, 'print da partida.png', 'image/png'))
  })

  it('opens the viewer, whose image has the same menu without the message', async () => {
    renderInMessage(<MessageAttachments attachments={[photo]} own={false} />)
    fireEvent.contextMenu(screen.getByTitle(photo.filename))
    fireEvent.click(screen.getByText('Abrir imagem'))
    expect(useImageViewer.getState().open?.images).toHaveLength(1)
    const { ImageViewerHost } = await import('./ImageViewer')
    render(<ImageViewerHost />)
    const inViewer = screen.getAllByAltText(photo.filename).find((img) => img.classList.contains('object-contain'))!
    fireEvent.contextMenu(inViewer)
    expect(labels()).toEqual(['Copiar imagem', 'Salvar imagem como…'])
  })

  it('only copies the link of a Klipy GIF, never downloading it', () => {
    const gif = { id: 'g1', title: 'gato', url: 'https://static.klipy.com/gato.webp', format: 'webp' as const, preview: null, width: 200, height: 200 }
    renderInMessage(<GifMessage gif={gif} />)
    fireEvent.contextMenu(screen.getByTitle('gato'))
    expect(labels()).toEqual(['Copiar link do GIF', 'Copiar link da mensagem'])
    expect(fetchSpy).not.toHaveBeenCalledWith(gif.url)
  })
})
