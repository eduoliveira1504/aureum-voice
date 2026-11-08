import { Download, File, FileArchive, FileAudio, FileText, ImageOff, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import type { Attachment } from '../lib/api'
import { downloadAttachment, formatSize, useAttachmentUrl } from '../lib/attachments'
import { openImages, type ViewableImage } from '../lib/chatImages'
import { useImageMenu, type ImageGallery } from './ImageMenu'
import { VoicePlayer } from './VoicePlayer'

/** A message's files: images and videos inline, anything else as a card with a download button. */
export function MessageAttachments({ attachments, own }: { attachments: Attachment[]; own: boolean }): ReactNode {
  const images = attachments.filter((a) => a.kind === 'image')
  const viewable: ViewableImage[] = images.map((attachment) => ({ kind: 'attachment', attachment, name: attachment.filename }))
  const others = attachments.filter((a) => a.kind !== 'image')
  const single = images.length === 1

  return (
    <div className={`mt-1 flex w-full flex-col gap-1.5 ${own ? 'items-end' : 'items-start'}`}>
      {images.length > 0 && (
        <div className={single ? '' : 'grid w-full max-w-[420px] grid-cols-2 gap-1.5'}>
          {images.map((a, i) => (
            <ImageThumb key={a.id} attachment={a} single={single} gallery={{ images: viewable, index: i }} />
          ))}
        </div>
      )}
      {others.map((a) =>
        a.kind === 'voice' ? (
          <VoicePlayer key={a.id} attachment={a} own={own} />
        ) : a.kind === 'video' ? (
          <VideoPlayer key={a.id} attachment={a} />
        ) : (
          <FileCard key={a.id} attachment={a} />
        )
      )}
    </div>
  )
}

// A single image shows at most this big; the box takes the image's own size, never the row's.
const IMAGE_MAX = { width: 360, height: 320 }

/** The size a lone image shows at: its own, scaled down (never up) to fit IMAGE_MAX. */
export function fitImage(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, IMAGE_MAX.width / width, IMAGE_MAX.height / height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function ImageThumb({ attachment, single, gallery }: { attachment: Attachment; single: boolean; gallery: ImageGallery }): ReactNode {
  const { url, failed } = useAttachmentUrl(attachment)
  const onOpen = (): void => openImages(gallery.images, gallery.index)
  // Right click: copy, save, open, then the message's options.
  const onContextMenu = useImageMenu(gallery.images[gallery.index], gallery)
  // Files sent before the API measured images: their size once loaded.
  const [loaded, setLoaded] = useState<{ width: number; height: number } | null>(null)
  const natural = attachment.width && attachment.height ? { width: attachment.width, height: attachment.height } : loaded
  if (failed) return <Unavailable attachment={attachment} />
  if (!single) {
    return (
      <button type="button" onClick={onOpen} onContextMenu={onContextMenu} title={attachment.filename} className="block aspect-square overflow-hidden rounded-control border border-line bg-elevated">
        {url ? (
          <img src={url} alt={attachment.filename} className="block aspect-square w-full object-cover" draggable={false} />
        ) : (
          <span className="block aspect-square w-full animate-pulse bg-elevated" />
        )}
      </button>
    )
  }
  const size = natural && fitImage(natural.width, natural.height)
  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onContextMenu}
      title={attachment.filename}
      // Width and ratio from the image itself (max-w-full on narrow chats): the box never runs
      // past the picture, and the room is saved before it loads.
      style={size ? { width: size.width, aspectRatio: `${size.width} / ${size.height}` } : undefined}
      className={`block max-w-full overflow-hidden rounded-control border border-line bg-elevated ${size ? '' : 'w-fit'}`}
    >
      {url ? (
        <img
          src={url}
          alt={attachment.filename}
          draggable={false}
          onLoad={(e) => !natural && setLoaded({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          className={size ? 'block h-full w-full object-cover' : 'block max-h-80 max-w-[min(360px,100%)]'}
        />
      ) : (
        !size && <span className="block h-48 w-72 max-w-full animate-pulse bg-elevated" />
      )}
    </button>
  )
}

function VideoPlayer({ attachment }: { attachment: Attachment }): ReactNode {
  const { url, failed } = useAttachmentUrl(attachment)
  if (failed) return <Unavailable attachment={attachment} />
  // w-fit: a portrait clip gets a narrow box, not black bands across the row.
  return (
    <div className="w-fit max-w-full overflow-hidden rounded-control border border-line bg-black">
      {url ? (
        <video src={url} controls preload="metadata" className="block max-h-80 max-w-[min(420px,100%)]" />
      ) : (
        <span className="block aspect-video w-[420px] max-w-full animate-pulse bg-elevated" />
      )}
    </div>
  )
}

function fileIcon(name: string): typeof File {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return FileArchive
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'opus'].includes(ext)) return FileAudio
  if (['txt', 'md', 'pdf', 'doc', 'docx', 'odt', 'csv', 'xls', 'xlsx', 'ppt', 'pptx', 'json'].includes(ext)) return FileText
  return File
}

export function FileCard({ attachment }: { attachment: Attachment }): ReactNode {
  const Icon = fileIcon(attachment.filename)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const download = (): void => {
    setBusy(true)
    downloadAttachment(attachment).then(
      () => setFailed(false),
      () => setFailed(true)
    ).finally(() => setBusy(false))
  }
  return (
    <div className="flex w-full max-w-[360px] items-center gap-3 rounded-control border border-line bg-elevated px-3 py-2.5">
      <Icon size={30} className="shrink-0 text-accent-text" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={attachment.filename}>
          {attachment.filename}
        </p>
        <p className={`text-xs ${failed ? 'text-danger' : 'text-fg-subtle'}`}>{failed ? 'Não foi possível baixar' : formatSize(attachment.size)}</p>
      </div>
      <button
        type="button"
        title="Baixar"
        aria-label={`Baixar ${attachment.filename}`}
        disabled={busy}
        onClick={download}
        className="shrink-0 rounded-item p-2 text-fg-muted hover:bg-panel hover:text-fg disabled:opacity-50"
      >
        <Download size={18} />
      </button>
    </div>
  )
}

function Unavailable({ attachment }: { attachment: Attachment }): ReactNode {
  return (
    <div className="flex items-center gap-2 rounded-control border border-line bg-elevated px-3 py-2 text-sm text-fg-subtle">
      <ImageOff size={16} /> {attachment.filename} não está disponível
    </div>
  )
}

/** A file being added to a message: preview or icon, progress, and a way to drop it. */
export interface PendingFile {
  key: string
  file: File
  name: string
  progress: number
  status: 'uploading' | 'done' | 'error'
  error?: string
  attachment?: Attachment
  preview?: string
  abort(): void
}

export function PendingFiles({ files, onRemove }: { files: PendingFile[]; onRemove(key: string): void }): ReactNode {
  if (!files.length) return null
  return (
    <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
      {files.map((f) => {
        const Icon = fileIcon(f.name)
        return (
          <div key={f.key} className="relative w-36 shrink-0 overflow-hidden rounded-control border border-line bg-elevated">
            <div className="flex h-20 items-center justify-center bg-panel">
              {f.preview ? <img src={f.preview} alt="" className="h-full w-full object-cover" /> : <Icon size={30} className="text-fg-subtle" />}
            </div>
            <div className="px-2 py-1.5">
              <p className="truncate text-xs font-medium" title={f.name}>
                {f.name}
              </p>
              <p className={`truncate text-[11px] ${f.status === 'error' ? 'text-danger' : 'text-fg-subtle'}`} title={f.error}>
                {f.status === 'error' ? f.error : f.status === 'done' ? formatSize(f.file.size) : `${Math.round(f.progress * 100)}%`}
              </p>
            </div>
            {f.status === 'uploading' && (
              <div className="absolute inset-x-0 bottom-0 h-1 bg-line">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.max(4, f.progress * 100)}%` }} />
              </div>
            )}
            <button
              type="button"
              title="Remover"
              aria-label={`Remover ${f.name}`}
              onClick={() => onRemove(f.key)}
              className="absolute right-1 top-1 rounded-full bg-panel/90 p-1 text-fg-muted hover:text-danger"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
