import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type LinkPreview, type Message } from '../lib/api'
import { useChat } from '../store/chat'
import { LinkPreviews } from './LinkPreviews'

vi.mock('../lib/api', async (original) => ({ ...(await original<object>()), api: vi.fn() }))

const link: LinkPreview = {
  url: 'https://example.com/post',
  kind: 'link',
  site: 'Exemplo',
  title: 'Um título',
  description: 'Descrição do post',
  image: '/api/media/previews/abc.webp',
  image_width: 640,
  image_height: 336
}
const video: LinkPreview = {
  url: 'https://youtu.be/dQw4w9WgXcQ',
  kind: 'youtube',
  site: 'YouTube',
  title: 'Clipe novo',
  description: null,
  image: '/api/media/previews/def.webp',
  image_width: 480,
  image_height: 360,
  channel: 'Canal do Fulano',
  video_id: 'dQw4w9WgXcQ'
}
const message = (cards: LinkPreview[]): Message =>
  ({ id: 7, channel_id: 'c1', content: 'olha', attachments: [], link_previews: cards }) as unknown as Message

beforeEach(() => {
  vi.mocked(api).mockReset()
  useChat.setState({ messages: { c1: { items: [message([link])], hasMore: false, loaded: true, loading: false } } })
})

describe('LinkPreviews', () => {
  it('shows the site, title, description and our copy of the image', () => {
    const { container } = render(<LinkPreviews message={message([link])} own={false} />)
    expect(screen.getByText('Exemplo')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Um título' }).getAttribute('href')).toBe(link.url)
    expect(screen.getByText('Descrição do post')).toBeTruthy()
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toMatch(/\/api\/media\/previews\/abc\.webp$/)
    // Room kept from the saved size, scaled to the box.
    expect([img.style.width, img.style.height]).toEqual(['400px', '210px'])
    expect(screen.queryByLabelText('Remover prévia')).toBeNull()
  })

  it('never loads an image straight from the site', () => {
    const { container } = render(<LinkPreviews message={message([{ ...link, image: 'https://tracker.example/x.png' }])} own={false} />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('YouTube: channel and a play that opens the browser', () => {
    render(<LinkPreviews message={message([video])} own={false} />)
    expect(screen.getByText(/Canal do Fulano/)).toBeTruthy()
    const play = screen.getByLabelText('Assistir Clipe novo no navegador')
    expect([play.getAttribute('href'), play.getAttribute('target')]).toEqual([video.url, '_blank'])
  })

  it('the author removes them', async () => {
    vi.mocked(api).mockResolvedValueOnce(message([]))
    render(<LinkPreviews message={message([link])} own />)
    fireEvent.click(screen.getByLabelText('Remover prévia'))
    expect(api).toHaveBeenCalledWith('/messages/7/previews', { method: 'DELETE' })
    await vi.waitFor(() => expect(useChat.getState().messages.c1.items[0].link_previews).toEqual([]))
  })
})
