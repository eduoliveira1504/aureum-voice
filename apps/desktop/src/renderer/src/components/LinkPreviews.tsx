import { Play, X } from 'lucide-react'
import type { ReactNode } from 'react'

import { mediaUrl, type LinkPreview, type Message } from '../lib/api'
import { useChat } from '../store/chat'

const IMAGE_MAX_W = 400
const IMAGE_MAX_H = 225

/** The card image comes from our API (/api/media); the app never loads it from the site. */
const imageOf = (card: LinkPreview): string | undefined => (card.image?.startsWith('/api/media/') ? mediaUrl(card.image) : undefined)

/** The image's box, from its saved size: room kept before it loads, never scaled up. */
function imageBox(card: LinkPreview, maxW: number, maxH: number): { width: number; height: number } | undefined {
  if (!card.image_width || !card.image_height) return undefined
  const scale = Math.min(1, maxW / card.image_width, maxH / card.image_height)
  return { width: Math.round(card.image_width * scale), height: Math.round(card.image_height * scale) }
}

/** The cards of the links in a message (filled by the API a moment after it's sent). Its
 * author can take them away with the X. */
export function LinkPreviews({ message, own }: { message: Message; own: boolean }): ReactNode {
  const cards = message.link_previews ?? []
  if (cards.length === 0) return null
  const remove = own ? () => void useChat.getState().removePreviews(message).catch(() => {}) : undefined
  return (
    <div className={`mt-1 flex max-w-full flex-col gap-1.5 ${own ? 'items-end' : 'items-start'}`}>
      {cards.map((card) =>
        card.kind === 'youtube' ? <YouTubeCard key={card.url} card={card} onRemove={remove} /> : <LinkCard key={card.url} card={card} onRemove={remove} />
      )}
    </div>
  )
}

function RemoveButton({ onRemove }: { onRemove?: () => void }): ReactNode {
  if (!onRemove) return null
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label="Remover prévia"
      title="Remover prévia"
      className="absolute right-1.5 top-1.5 rounded-item p-1 text-fg-subtle opacity-0 hover:bg-main hover:text-fg focus-visible:opacity-100 group-hover/card:opacity-100"
    >
      <X size={14} />
    </button>
  )
}

function LinkCard({ card, onRemove }: { card: LinkPreview; onRemove?: () => void }): ReactNode {
  const image = imageOf(card)
  const box = imageBox(card, IMAGE_MAX_W, IMAGE_MAX_H)
  return (
    <div className="group/card relative w-fit min-w-0 max-w-[432px] overflow-hidden rounded-control border border-line bg-elevated p-3 pr-8">
      <p className="truncate text-xs text-fg-subtle">{card.site}</p>
      {card.title && (
        <a href={card.url} target="_blank" rel="noreferrer" className="mt-0.5 line-clamp-2 font-semibold text-accent-text hover:underline">
          {card.title}
        </a>
      )}
      {card.description && <p className="mt-1 line-clamp-3 text-sm text-fg-muted">{card.description}</p>}
      {image && (
        <a href={card.url} target="_blank" rel="noreferrer" tabIndex={-1} className="mt-2 block">
          <img
            src={image}
            alt=""
            loading="lazy"
            style={box}
            className={`max-w-full rounded-item object-cover ${box ? '' : 'max-h-[225px]'}`}
          />
        </a>
      )}
      <RemoveButton onRemove={onRemove} />
    </div>
  )
}

/** A YouTube link: big thumbnail with play, which opens the video in the browser (it doesn't play
 * inside the app). */
function YouTubeCard({ card, onRemove }: { card: LinkPreview; onRemove?: () => void }): ReactNode {
  const image = imageOf(card)
  return (
    <div className="group/card relative w-[432px] max-w-full overflow-hidden rounded-control border border-line bg-elevated p-3 pr-8">
      <p className="truncate text-xs text-fg-subtle">
        YouTube{card.channel && <> · {card.channel}</>}
      </p>
      {card.title && (
        <a href={card.url} target="_blank" rel="noreferrer" className="mt-0.5 line-clamp-2 font-semibold text-accent-text hover:underline">
          {card.title}
        </a>
      )}
      <a
        href={card.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Assistir ${card.title ?? 'vídeo'} no navegador`}
        className="group/play relative mt-2 block aspect-video w-full overflow-hidden rounded-item bg-main"
      >
        {image && <img src={image} alt="" loading="lazy" className="h-full w-full object-cover" />}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white transition-transform group-hover/play:scale-110">
            <Play size={26} fill="currentColor" className="ml-1" />
          </span>
        </span>
      </a>
      <RemoveButton onRemove={onRemove} />
    </div>
  )
}
