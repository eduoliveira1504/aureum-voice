import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type Gif } from '../lib/api'
import { gifOf, GifsUnavailable, useGifs, type KlipyItem } from '../store/gifs'
import { GifMessage, GifPanel } from './Gifs'

vi.mock('../lib/api', async (original) => ({ ...(await original<object>()), api: vi.fn() }))

const CONFIG = { enabled: true, provider: 'klipy', app_key: 'k3y', customer_id: 'c1d', content_filter: 'high', locale: 'br' }
const r = (name: string, w = 200, h = 150) => ({ url: `https://static.klipy.com/${name}`, width: w, height: h })
const item = (id: number, title: string): KlipyItem => ({
  id,
  title,
  type: 'gif',
  file: { md: { mp4: r(`${id}.mp4`, 498, 280), jpg: r(`${id}.jpg`) }, sm: { webp: r(`${id}-sm.webp`) } }
})
const answer = (items: KlipyItem[], hasNext = false) =>
  new Response(JSON.stringify({ result: true, data: { data: items, current_page: 1, has_next: hasNext } }), { status: 200 })

const fetchMock = vi.fn()

beforeEach(() => {
  vi.mocked(api).mockReset()
  vi.mocked(api).mockImplementation(async (path: string) => (path === '/gifs/favorites' ? [] : CONFIG) as never)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  useGifs.setState({ config: null, favorites: [], favoritesLoaded: false })
})
afterEach(() => vi.unstubAllGlobals())

describe('Klipy, from the app', () => {
  it('trending and search go straight to Klipy with the key, an anonymous id, the safest filter and Brazil', async () => {
    fetchMock.mockImplementation(async () => answer([item(1, 'oi')], true))
    expect(await useGifs.getState().search('', 1)).toEqual({ items: [item(1, 'oi')], hasNext: true })
    const trending = new URL(fetchMock.mock.calls[0][0])
    expect(trending.origin + trending.pathname).toBe('https://api.klipy.com/api/v1/k3y/gifs/trending')
    expect(Object.fromEntries(trending.searchParams)).toMatchObject({ customer_id: 'c1d', locale: 'br', content_filter: 'high', page: '1' })

    await useGifs.getState().search('bom dia', 2)
    const search = new URL(fetchMock.mock.calls[1][0])
    expect(search.pathname).toBe('/api/v1/k3y/gifs/search')
    expect([search.searchParams.get('q'), search.searchParams.get('page')]).toEqual(['bom dia', '2'])
    expect(api).toHaveBeenCalledTimes(1) // the config is asked once
  })

  it('turns a result into what a message keeps: MP4, a still and its size', () => {
    expect(gifOf(item(7, 'gg'))).toEqual({
      id: '7',
      title: 'gg',
      url: 'https://static.klipy.com/7.mp4',
      format: 'mp4',
      preview: 'https://static.klipy.com/7.jpg',
      width: 498,
      height: 280
    })
    expect(gifOf({ id: 1 })).toBeNull()
  })

  it('a provider that is down or off is a friendly error', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 503 }))
    await expect(useGifs.getState().search('', 1)).rejects.toBeInstanceOf(GifsUnavailable)
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await expect(useGifs.getState().search('', 1)).rejects.toBeInstanceOf(GifsUnavailable)
    useGifs.setState({ config: { ...CONFIG, enabled: false, app_key: null } })
    await expect(useGifs.getState().search('', 1)).rejects.toBeInstanceOf(GifsUnavailable)
  })
})

describe('the GIFs tab', () => {
  it('says "Search KLIPY", shows trending in order and sends the picked one', async () => {
    fetchMock.mockImplementation(async () => answer([item(1, 'primeiro'), item(2, 'segundo')]))
    const onPick = vi.fn()
    render(<GifPanel onPick={onPick} />)
    expect(screen.getByPlaceholderText('Search KLIPY')).toBeTruthy()
    const tiles = await screen.findAllByRole('button', { name: /primeiro|segundo/ })
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(['primeiro', 'segundo'])
    fireEvent.click(tiles[1])
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: '2', url: 'https://static.klipy.com/2.mp4' }))
    expect(screen.getByText('Powered by KLIPY')).toBeTruthy()
  })

  it('shows a friendly message when Klipy is down', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 500 }))
    render(<GifPanel onPick={vi.fn()} />)
    expect(await screen.findByText('Os GIFs estão fora do ar agora. Tente daqui a pouco.')).toBeTruthy()
  })
})

describe('favorites', () => {
  const gif = gifOf(item(3, 'kkk')) as Gif

  it('stars right away and undoes it if the API refuses', async () => {
    vi.mocked(api).mockResolvedValueOnce(undefined as never)
    await useGifs.getState().toggleFavorite(gif)
    expect(api).toHaveBeenCalledWith('/gifs/favorites/3', { method: 'PUT', body: gif })
    expect(useGifs.getState().favorites).toEqual([gif])

    vi.mocked(api).mockRejectedValueOnce(new ApiError(500, 'x'))
    await expect(useGifs.getState().toggleFavorite(gif)).rejects.toThrow()
    expect(useGifs.getState().favorites).toEqual([gif])
  })

  it('follow other devices', () => {
    useGifs.getState().applyEvent({ type: 'gifs.favorites', data: { favorites: [gif] } })
    expect(useGifs.getState().favorites).toEqual([gif])
  })
})

describe('a GIF message', () => {
  it('plays muted in a loop, at its size', () => {
    const { container } = render(<GifMessage gif={gifOf(item(4, 'oi'))!} />)
    const video = container.querySelector('video')!
    expect([video.muted, video.loop, video.getAttribute('src')]).toEqual([true, true, 'https://static.klipy.com/4.mp4'])
    expect(video.getAttribute('poster')).toBe('https://static.klipy.com/4.jpg')
    expect((container.firstChild as HTMLElement).style.width).toBe('360px')
  })
})
