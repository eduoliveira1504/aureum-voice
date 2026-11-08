/** Block 3.22B: "Alterar avatar/banner" offers a file or a Klipy GIF; a GIF goes through the crop
 * editor and is saved as a reference (PUT …/gif), never uploaded. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { ProfileGif } from '../lib/api'
import { useGifs, type KlipyItem } from '../store/gifs'
import { ContextMenuHost } from './ContextMenu'
import { CroppedImageRow } from './ImageCropper'

const MP4 = 'https://static.klipy.com/ii/abc/md.mp4'
const STILL = 'https://static.klipy.com/ii/abc/md.jpg'
const ITEM: KlipyItem = {
  id: 8041071659142944,
  title: 'Oi',
  file: {
    md: { mp4: { url: MP4, width: 498, height: 280 }, jpg: { url: STILL, width: 498, height: 280 } },
    sm: { webp: { url: 'https://static.klipy.com/ii/abc/sm.webp', width: 220, height: 124 } }
  }
}
const CONFIG = { enabled: true, provider: 'klipy', app_key: 'k', customer_id: 'c', content_filter: 'high', locale: 'br' }

class FakeImage {
  naturalWidth = 400
  naturalHeight = 200
  onload: (() => void) | null = null
  set src(_: string) {
    queueMicrotask(() => this.onload?.())
  }
}

function row(kind: 'avatar' | 'banner', extra: Partial<Parameters<typeof CroppedImageRow>[0]> = {}): void {
  render(
    <>
      <CroppedImageRow
        label={kind === 'avatar' ? 'Avatar' : 'Banner'}
        shape={kind}
        path={`/users/me/${kind}`}
        hasImage={false}
        crop={null}
        gifs
        name="Ana"
        onDone={onDone}
        {...extra}
      />
      <ContextMenuHost />
    </>
  )
}

const onDone = vi.fn()
let call: ReturnType<typeof vi.spyOn>
const search = vi.fn(async () => ({ items: [ITEM], hasNext: false }))

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage)
  URL.createObjectURL = vi.fn(() => 'blob:picked')
  URL.revokeObjectURL = vi.fn()
  call = vi.spyOn(api, 'api').mockResolvedValue({ id: 'me' })
  onDone.mockClear()
  search.mockClear()
  useGifs.setState({ config: CONFIG, favorites: [], favoritesLoaded: true, search })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Alterar avatar / banner', () => {
  it.each(['avatar', 'banner'] as const)('offers "Enviar imagem" and "Escolher um GIF" (%s)', async (kind) => {
    row(kind)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: `Alterar ${kind}` }))
    expect(screen.getByText('Enviar imagem')).toBeTruthy()
    expect(screen.getByText('Escolher um GIF')).toBeTruthy()
  })

  it('a picked GIF goes through the crop editor and is saved by reference', async () => {
    row('avatar')
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Alterar avatar' }))
    fireEvent.click(screen.getByText('Escolher um GIF'))
    expect(screen.getByRole('dialog', { name: 'Escolher um GIF' })).toBeTruthy()
    // The chat's picker: Klipy's attribution and its search.
    expect(screen.getByPlaceholderText('Search KLIPY')).toBeTruthy()
    await act(async () => {})
    expect(search).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Oi' }))
    expect(screen.getByRole('dialog', { name: 'Ajustar imagem' })).toBeTruthy()
    // The MP4 plays (as a video) straight from Klipy in the editor and its previews.
    const videos = Array.from(document.querySelectorAll('video'))
    expect(videos.length).toBeGreaterThan(1)
    expect(videos.every((v) => v.getAttribute('src') === MP4)).toBe(true)

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' })))
    const [path, options] = call.mock.calls.at(-1) as [string, { method: string; body: { gif: api.Gif; crop: api.ImageCrop } }]
    expect(path).toBe('/users/me/avatar/gif')
    expect(options.method).toBe('PUT')
    expect(options.body.gif).toMatchObject({ id: '8041071659142944', url: MP4, format: 'mp4', preview: STILL, width: 498, height: 280 })
    // Centered at zoom 1: the middle 280 x 280 of the 498 x 280 GIF.
    expect(options.body.crop).toEqual({ x: 109, y: 0, width: 280, height: 280, rotate: 0 })
    expect(onDone).toHaveBeenCalled()
  })

  it('uploading a file stays as before', async () => {
    row('banner')
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Alterar banner' }))
    fireEvent.click(screen.getByText('Enviar imagem'))
    fireEvent.change(screen.getByLabelText('Arquivo de banner'), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
    await act(async () => {})
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' })))
    const [path, options] = call.mock.calls.at(-1) as [string, { method: string; body: FormData }]
    expect(path).toBe('/users/me/banner')
    expect(options.body.get('crop')).toBeTruthy()
  })

  it('without GIFs (no Klipy key) the button just opens the file picker', async () => {
    useGifs.setState({ config: { ...CONFIG, enabled: false, app_key: null } })
    row('avatar')
    await act(async () => {})
    const input = screen.getByLabelText('Arquivo de avatar') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: 'Alterar avatar' }))
    expect(click).toHaveBeenCalled()
    expect(screen.queryByText('Escolher um GIF')).toBeNull()
  })

  it('"Ajustar posição" of a GIF loads it from Klipy and only changes the crop', async () => {
    const current: ProfileGif = {
      id: '1', title: 'Oi', url: MP4, format: 'mp4', preview: STILL, width: 498, height: 280, crop: { x: 0, y: 0, width: 280, height: 280, rotate: 0 }
    }
    const fetchMedia = vi.spyOn(api, 'fetchMedia')
    row('avatar', { hasImage: true, crop: current.crop, currentGif: current })
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Ajustar posição' }))
    expect(fetchMedia).not.toHaveBeenCalled()
    expect(document.querySelector(`video[src="${MP4}"]`)).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' })))
    const [path, options] = call.mock.calls.at(-1) as [string, { method: string; body: api.ImageCrop }]
    expect(path).toBe('/users/me/avatar/crop')
    expect(options.body).toEqual(current.crop)
  })
})
