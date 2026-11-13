import { Search, Star } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { Gif } from '../lib/api'
import { gifOf, GifsUnavailable, prefersReducedMotion, thumbOf, useGifs, type KlipyItem } from '../store/gifs'
import { fitImage } from './Attachments'
import { toast } from './ContextMenu'
import { useImageMenu } from './ImageMenu'
import { cn, inputClass } from './ui'
import { t } from '../lib/i18n'

/** Plays while on screen, muted and looping; paused when it scrolls away. With reduced motion it
 * shows its still and plays only while the mouse is over it. */
function useAutoplay(): { ref: React.RefObject<HTMLVideoElement | null>; hover: { onMouseEnter(): void; onMouseLeave(): void } } {
  const ref = useRef<HTMLVideoElement>(null)
  const reduced = prefersReducedMotion()
  useEffect(() => {
    const video = ref.current
    if (!video || reduced || typeof IntersectionObserver === 'undefined') return
    const watch = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void video.play().catch(() => {})
      else video.pause()
    })
    watch.observe(video)
    return () => watch.disconnect()
  }, [reduced])
  return {
    ref,
    hover: {
      onMouseEnter: () => reduced && void ref.current?.play().catch(() => {}),
      onMouseLeave: () => {
        if (!reduced || !ref.current) return
        ref.current.pause()
        ref.current.currentTime = 0
      }
    }
  }
}

function StarButton({ gif, className = '' }: { gif: Gif; className?: string }): ReactNode {
  const starred = useGifs((s) => s.favorites.some((f) => f.id === gif.id))
  useEffect(() => {
    if (!useGifs.getState().favoritesLoaded) void useGifs.getState().loadFavorites().catch(() => {})
  }, [])
  return (
    <button
      type="button"
      title={starred ? t('media.gifs.unstar') : t('media.gifs.star')}
      aria-label={starred ? t('media.gifs.unstar') : t('media.gifs.star')}
      aria-pressed={starred}
      onClick={(e) => {
        e.stopPropagation()
        void useGifs.getState().toggleFavorite(gif).catch(() => toast(t('media.gifs.starFailed')))
      }}
      className={cn('rounded-full bg-black/55 p-1.5 text-white hover:bg-black/75', starred ? 'opacity-100' : 'opacity-0 group-hover/gif:opacity-100 focus-visible:opacity-100', className)}
    >
      <Star size={14} fill={starred ? 'currentColor' : 'none'} />
    </button>
  )
}

/** A GIF in a message: its own size (at most 360x320), playing in a loop without sound. */
export function GifMessage({ gif }: { gif: Gif }): ReactNode {
  const box = fitImage(gif.width, gif.height)
  const { ref, hover } = useAutoplay()
  // Only its link: the app never downloads Klipy's GIFs (ADR 0034).
  const onContextMenu = useImageMenu({ kind: 'gif', url: gif.url })
  return (
    <div
      className="group/gif relative my-0.5 w-fit max-w-full overflow-hidden rounded-control bg-elevated"
      // Width and ratio, not a fixed height: in a narrow panel it shrinks without being cropped.
      style={{ width: box.width, aspectRatio: `${box.width} / ${box.height}` }}
      {...hover}
      onContextMenu={onContextMenu}
      title={gif.title || 'GIF'}
    >
      {gif.format === 'mp4' ? (
        <video
          ref={ref}
          src={gif.url}
          poster={gif.preview ?? undefined}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={gif.title || 'GIF'}
          className="h-full w-full object-cover"
        />
      ) : (
        <img src={gif.url} alt={gif.title || 'GIF'} loading="lazy" className="h-full w-full object-cover" />
      )}
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-item bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white">{t('media.gifs.badge')}</span>
      <StarButton gif={gif} className="absolute right-1.5 top-1.5" />
    </div>
  )
}

// --- Picker tab ------------------------------------------------------------------------------

type View = 'trending' | 'favorites'

/** The "GIFs" tab of the picker: Klipy's trending and search, and the user's favorites. */
export function GifPanel({ onPick }: { onPick(gif: Gif): void }): ReactNode {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>('trending')
  const [items, setItems] = useState<KlipyItem[]>([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const favorites = useGifs((s) => s.favorites)
  const searching = query.trim().length > 0
  const run = useRef(0)

  useEffect(() => {
    if (!useGifs.getState().favoritesLoaded) void useGifs.getState().loadFavorites().catch(() => {})
  }, [])

  // Trending right away; a search a moment after typing stops.
  useEffect(() => {
    if (!searching && view === 'favorites') return
    const mine = ++run.current
    setState('loading')
    const timer = setTimeout(
      () => {
        useGifs
          .getState()
          .search(query, 1)
          .then(
            (result) => {
              if (mine !== run.current) return
              setItems(result.items)
              setHasNext(result.hasNext)
              setPage(1)
              setState('ready')
            },
            () => mine === run.current && setState('error')
          )
      },
      searching ? 350 : 0
    )
    return () => clearTimeout(timer)
  }, [query, view, searching])

  async function more(): Promise<void> {
    const mine = run.current
    try {
      const result = await useGifs.getState().search(query, page + 1)
      if (mine !== run.current) return
      setItems((list) => [...list, ...result.items])
      setHasNext(result.hasNext)
      setPage((p) => p + 1)
    } catch (err) {
      toast(err instanceof GifsUnavailable ? t('media.gifs.down') : t('media.gifs.moreFailed'))
    }
  }

  const showFavorites = view === 'favorites' && !searching
  const tiles = showFavorites
    ? favorites.map((gif) => ({ gif, thumb: { url: gif.preview ?? gif.url, width: gif.width, height: gif.height } }))
    : items.flatMap((item) => {
        const gif = gifOf(item)
        const thumb = thumbOf(item)
        return gif && thumb ? [{ gif, thumb }] : []
      })
  const reduced = prefersReducedMotion()

  return (
    <>
      <div className="space-y-2 border-b border-line p-2">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
          {/* Klipy's attribution rules ask for exactly this placeholder. */}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search KLIPY"
            aria-label={t('media.gifs.search')}
            className={cn(inputClass, 'py-1.5 pl-8 text-sm')}
          />
        </div>
        {!searching && (
          <div className="flex gap-1 text-sm">
            {(
              [
                ['trending', t('media.gifs.trending')],
                ['favorites', t('media.gifs.favorites')]
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => setView(key)}
                className={`rounded-full px-3 py-1 ${view === key ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-elevated'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!showFavorites && state === 'error' ? (
          <p className="py-8 text-center text-sm text-fg-subtle">{t('media.gifs.downLong')}</p>
        ) : !showFavorites && state === 'loading' ? (
          <p className="py-8 text-center text-sm text-fg-subtle">{t('common.loading')}</p>
        ) : tiles.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-subtle">
            {showFavorites ? t('media.gifs.noFavorites') : t('media.gifs.none')}
          </p>
        ) : (
          <>
            {/* Two columns, in Klipy's order (left to right, top to bottom). */}
            <div className="grid grid-cols-2 gap-1.5">
              {tiles.map(({ gif, thumb }) => (
                <div key={gif.id} className="group/gif relative">
                  <button
                    type="button"
                    onClick={() => onPick(gif)}
                    aria-label={gif.title || 'GIF'}
                    title={gif.title}
                    className="block w-full overflow-hidden rounded-item bg-elevated"
                    style={{ aspectRatio: `${thumb.width} / ${thumb.height}` }}
                  >
                    {showFavorites && gif.format === 'mp4' && !reduced ? (
                      <video src={gif.url} poster={gif.preview ?? undefined} muted loop autoPlay playsInline className="h-full w-full object-cover" />
                    ) : (
                      <img src={reduced && gif.preview ? gif.preview : thumb.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    )}
                  </button>
                  <StarButton gif={gif} className="absolute right-1 top-1" />
                </div>
              ))}
            </div>
            {!showFavorites && hasNext && (
              <button type="button" onClick={() => void more()} className="mt-2 w-full rounded-item py-2 text-sm text-fg-muted hover:bg-elevated hover:text-fg">
                {t('media.gifs.loadMore')}
              </button>
            )}
          </>
        )}
      </div>
      <p className="flex h-9 shrink-0 items-center border-t border-line px-3 text-sm text-fg-subtle">Powered by KLIPY</p>
    </>
  )
}
