import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Attachment } from '../lib/api'
import { fitImage, MessageAttachments } from './Attachments'

vi.mock('../lib/attachments', () => ({
  useAttachmentUrl: () => ({ url: null, failed: false }),
  downloadAttachment: vi.fn(),
  formatSize: (n: number) => `${n} B`
}))

const image = (id: string, size?: { width: number; height: number }): Attachment => ({
  id,
  filename: `${id}.png`,
  kind: 'image',
  content_type: 'image/png',
  size: 100,
  url: `/api/media/attachments/${id}`,
  ...size
})

describe('fitImage', () => {
  it('scales down to the box, keeping the ratio, and never up', () => {
    expect(fitImage(1920, 1080)).toEqual({ width: 360, height: 203 })
    expect(fitImage(1080, 1920)).toEqual({ width: 180, height: 320 })
    expect(fitImage(100, 50)).toEqual({ width: 100, height: 50 })
  })
})

describe('MessageAttachments', () => {
  it("sizes a lone image's box from the image, before it loads", () => {
    render(<MessageAttachments attachments={[image('a', { width: 1920, height: 1080 })]} own={false} />)
    const box = screen.getByTitle('a.png')
    expect(box.style.width).toBe('360px')
    expect(box.style.aspectRatio).toBe('360 / 203')
    expect(box.classList.contains('w-full')).toBe(false)
  })

  it('shrinks to its content when the size is unknown (older files)', () => {
    render(<MessageAttachments attachments={[image('b')]} own={false} />)
    const box = screen.getByTitle('b.png')
    expect(box.style.width).toBe('')
    expect(box.classList.contains('w-fit')).toBe(true)
  })
})
