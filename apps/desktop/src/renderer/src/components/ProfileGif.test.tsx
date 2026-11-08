/** Block 3.22B: a Klipy GIF as avatar or banner, loaded from Klipy and drawn with its crop. */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { Me, ProfileGif } from '../lib/api'
import { ProfilePopover } from './ProfileCard'
import { Avatar, PresenceAvatar } from './ui'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: ME }, logout: async () => {}, setUser: () => {} })
}))

const WEBP: ProfileGif = {
  id: '8041071659142944',
  title: 'Oi',
  url: 'https://static.klipy.com/ii/abc/14/af/um0L4dFH.webp',
  format: 'webp',
  preview: 'https://static1.klipy.com/ii/abc/14/af/um0L4dFH.jpg',
  width: 498,
  height: 280,
  provider: 'klipy',
  // A square from x 10: at 88 px the GIF is 88/280 px per pixel, shifted 10 of them left.
  crop: { x: 10, y: 0, width: 280, height: 280, rotate: 0 }
}
const MP4: ProfileGif = { ...WEBP, id: '2', url: 'https://static.klipy.com/ii/abc/x.mp4', format: 'mp4' }

const ME: Me = {
  id: 'u-1',
  username: 'mari',
  display_name: 'Mari',
  avatar_url: WEBP.url,
  banner_url: MP4.preview,
  avatar_gif: WEBP,
  banner_gif: { ...MP4, crop: { x: 0, y: 50, width: 498, height: 176, rotate: 0 } },
  bio: null,
  accent_color: null,
  pronouns: null,
  custom_status: null,
  avatar_frame: 'none',
  favorite_song: null,
  links: [],
  badges: [],
  created_at: '2026-10-19T12:00:00Z',
  email: 'mari@exemplo.com',
  is_app_owner: false,
  email_verified: true,
  must_change_password: false
}

const media = (container: HTMLElement): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>('[data-profile-gif] img, [data-profile-gif] video'))

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'api').mockImplementation(async () => ME)
})

describe('a GIF avatar', () => {
  it('loads the URL exactly as Klipy gave it, with the crop applied by layout', () => {
    const { container } = render(<Avatar name="Mari" url={WEBP.url} gif={WEBP} size={88} />)
    const [img] = media(container)
    expect(img.tagName).toBe('IMG')
    expect(img.getAttribute('src')).toBe(WEBP.url)
    const box = img.parentElement!
    expect(parseFloat(box.style.left)).toBeCloseTo(-10 * (88 / 280), 3)
    expect(parseFloat(box.style.top)).toBeCloseTo(0, 3)
    expect(parseFloat(img.style.width)).toBeCloseTo(498 * (88 / 280), 3)
    // The frame clips it to the avatar's size and shape.
    expect(box.parentElement!.className).toContain('overflow-hidden')
    expect(box.parentElement!.className).toContain('rounded-full')
  })

  it('plays an MP4 muted in a loop', () => {
    const { container } = render(<Avatar name="Mari" gif={MP4} size={36} shape="rounded" />)
    const [video] = media(container) as HTMLVideoElement[]
    expect(video.tagName).toBe('VIDEO')
    expect(video.getAttribute('src')).toBe(MP4.url)
    expect(video.muted && video.loop && video.autoplay).toBe(true)
  })

  it('falls back to the initials when the GIF is gone from Klipy', () => {
    const { container } = render(<PresenceAvatar name="Mari" url={WEBP.url} gif={WEBP} status="online" />)
    fireEvent.error(media(container)[0])
    expect(media(container)).toHaveLength(0)
    expect(screen.getByText('M')).toBeTruthy()
    // Not the uncropped URL either: it's the same gone GIF.
    expect(container.querySelector(`img[src="${WEBP.url}"]`)).toBeNull()
  })

  it('an uploaded avatar shows as before', () => {
    const { container } = render(<Avatar name="Mari" url="/api/media/avatars/u-1/a.gif" size={32} />)
    expect(container.querySelector('img')!.getAttribute('src')).toMatch(/\/api\/media\/avatars\/u-1\/a\.gif$/)
    expect(container.querySelector('[data-profile-gif]')).toBeNull()
  })
})

describe('on the profile card', () => {
  it('shows the GIF avatar and banner, and the profile color when the banner is gone', () => {
    const { container } = render(<ProfilePopover user={ME} anchor={new DOMRect(100, 100, 40, 20)} onClose={() => {}} />)
    const shown = media(container)
    expect(shown.map((m) => m.getAttribute('src')).sort()).toEqual([MP4.url, WEBP.url].sort())
    // Never the still that older apps get as banner_url.
    expect(container.querySelector(`img[src="${MP4.preview}"]`)).toBeNull()

    fireEvent.error(shown.find((m) => m.tagName === 'VIDEO')!)
    expect(media(container).map((m) => m.getAttribute('src'))).toEqual([WEBP.url])
  })
})
