/**
 * Images in the chat that the right-click menu works on (3.24 B): attachments and stickers (fetched
 * with the token and cached, see attachments.ts), link preview images (from our API's /api/media)
 * and Klipy GIFs, which only have their link copied: the app never downloads them (ADR 0034).
 */
import { create } from 'zustand'

import { fetchMedia, type Attachment } from './api'
import { attachmentUrl } from './attachments'

export type ChatImage =
  | { kind: 'attachment'; attachment: Attachment; name: string }
  | { kind: 'url'; url: string; name: string }
  | { kind: 'gif'; url: string }

export type ViewableImage = Exclude<ChatImage, { kind: 'gif' }>

/** The bytes the app already has (or loads the way it shows the image), never another route. */
export async function imageBlob(image: ViewableImage): Promise<Blob> {
  if (image.kind === 'url') return fetchMedia(image.url)
  const blob = await (await fetch(await attachmentUrl(image.attachment))).blob()
  return blob.type ? blob : new Blob([blob], { type: image.attachment.content_type })
}

/** The picture as PNG, for the clipboard: a GIF or animated WebP gives its first frame. */
export async function toPng(blob: Blob): Promise<Uint8Array> {
  if (blob.type === 'image/png') return new Uint8Array(await blob.arrayBuffer())
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  bitmap.close()
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!png) throw new Error('Could not encode the image')
  return new Uint8Array(await png.arrayBuffer())
}

export async function copyImage(image: ViewableImage): Promise<void> {
  await window.aureum.images.copy(await toPng(await imageBlob(image)))
}

/** Windows' "Salvar como"; false if it was cancelled. */
export async function saveImage(image: ViewableImage): Promise<boolean> {
  const blob = await imageBlob(image)
  return window.aureum.images.save(new Uint8Array(await blob.arrayBuffer()), image.name, blob.type)
}

/** The full-screen viewer (ImageViewer.tsx), opened from a message or from the menu. */
interface ViewerState {
  open: { images: ViewableImage[]; start: number } | null
}

export const useImageViewer = create<ViewerState>()(() => ({ open: null }))

export function openImages(images: ViewableImage[], start = 0): void {
  if (images.length) useImageViewer.setState({ open: { images, start: Math.min(Math.max(0, start), images.length - 1) } })
}

export const closeImages = (): void => useImageViewer.setState({ open: null })
