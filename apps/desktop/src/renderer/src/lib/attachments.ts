/**
 * Attachments need the access token, so they're fetched by hand and shown through blob URLs.
 * Anything fetched once is kept: in memory (blob URLs, up to MEMORY_BYTES) and on disk by the
 * main process, so scrolling back or reopening a conversation doesn't download it again.
 * Attachment ids never change, so the cache never goes stale; it's wiped on logout.
 */

import { useEffect, useState } from 'react'

import { fetchMedia, type Attachment } from './api'

const MEMORY_BYTES = 150 * 1024 * 1024

interface Entry {
  url: string
  size: number
}

// Insertion order doubles as recency: a hit is moved to the end.
const memory = new Map<string, Entry>()
let memoryBytes = 0
const inFlight = new Map<string, Promise<string>>()

function remember(id: string, blob: Blob): string {
  const existing = memory.get(id)
  if (existing) return existing.url
  const entry = { url: URL.createObjectURL(blob), size: blob.size }
  memory.set(id, entry)
  memoryBytes += entry.size
  for (const [oldId, old] of memory) {
    if (memoryBytes <= MEMORY_BYTES || oldId === id) break
    // Only revoked when evicted: an <img> still showing it keeps its decoded copy.
    URL.revokeObjectURL(old.url)
    memory.delete(oldId)
    memoryBytes -= old.size
  }
  return entry.url
}

function fromMemory(id: string): string | null {
  const entry = memory.get(id)
  if (!entry) return null
  memory.delete(id)
  memory.set(id, entry)
  return entry.url
}

/** A blob URL for the attachment: from memory, then disk, then the server. */
export function attachmentUrl(attachment: Attachment): Promise<string> {
  const hit = fromMemory(attachment.id)
  if (hit) return Promise.resolve(hit)
  let pending = inFlight.get(attachment.id)
  if (!pending) {
    pending = (async () => {
      const type = attachment.content_type
      const cached = await window.aureum.attachments.get(attachment.id).catch(() => null)
      if (cached) return remember(attachment.id, new Blob([cached as BlobPart], { type }))
      const blob = await fetchMedia(attachment.url)
      void blob
        .arrayBuffer()
        .then((data) => window.aureum.attachments.put(attachment.id, new Uint8Array(data)))
        .catch(() => {})
      return remember(attachment.id, blob.type ? blob : new Blob([blob], { type }))
    })().finally(() => inFlight.delete(attachment.id))
    inFlight.set(attachment.id, pending)
  }
  return pending
}

/** Puts a file the user just sent in the cache, so their own message doesn't download it back. */
export function seedAttachment(attachment: Attachment, file: Blob): void {
  remember(attachment.id, file)
  void file
    .arrayBuffer()
    .then((data) => window.aureum.attachments.put(attachment.id, new Uint8Array(data)))
    .catch(() => {})
}

export function useAttachmentUrl(attachment: Attachment): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>(() => ({
    url: memory.get(attachment.id)?.url ?? null,
    failed: false
  }))
  useEffect(() => {
    let cancelled = false
    attachmentUrl(attachment).then(
      (url) => !cancelled && setState({ url, failed: false }),
      () => !cancelled && setState({ url: null, failed: true })
    )
    return () => {
      cancelled = true
    }
    // Keyed by id: the same file can come in a new message object after any update.
  }, [attachment.id])
  return state
}

/** Saves the attachment where the user picks (the app shows the system's save dialog). */
export async function downloadAttachment(attachment: Attachment): Promise<void> {
  const link = document.createElement('a')
  link.href = await attachmentUrl(attachment)
  link.download = attachment.filename
  link.click()
}

export async function clearAttachmentCache(): Promise<void> {
  for (const entry of memory.values()) URL.revokeObjectURL(entry.url)
  memory.clear()
  memoryBytes = 0
  await window.aureum.attachments.clear().catch(() => {})
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB']

export function formatSize(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${SIZE_UNITS[unit]}`
}

/** A message's text, or what it sent when it's only files ("enviou uma imagem"). */
export function messagePreview(message: { content: string; attachments: Attachment[] }): string {
  if (message.content) return message.content
  const files = message.attachments
  if (files.length === 1) {
    return files[0].kind === 'image' ? 'enviou uma imagem' : files[0].kind === 'video' ? 'enviou um vídeo' : `enviou ${files[0].filename}`
  }
  return files.every((f) => f.kind === 'image') ? `enviou ${files.length} imagens` : `enviou ${files.length} arquivos`
}
