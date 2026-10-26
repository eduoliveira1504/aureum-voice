import { Apple, Car, Clock, Flag, Gamepad2, Hand, Heart, Lightbulb, PawPrint, Search, Smile, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'

import {
  emojiQueryAt,
  loadEmojis,
  searchEmojis,
  splitEmoji,
  twemojiUrl,
  withRecent,
  withTone,
  type EmojiCatalog,
  type EmojiEntry,
  type SkinTone
} from '../lib/emoji'
import type { Sticker } from '../lib/api'
import { useAppearance } from '../store/appearance'
import { StickerPanel } from './Stickers'
import { cn, inputClass, menuClass } from './ui'

/** One emoji drawn with Twemoji, the same on every PC; the system's own if the drawing is missing.
 * `size` in px; by default it follows the text (1.25em). */
export function Emoji({ emoji, size, className = '' }: { emoji: string; size?: number; className?: string }): ReactNode {
  const url = twemojiUrl(emoji)
  const [failed, setFailed] = useState<string | null>(null)
  const box = size ? { width: size, height: size } : { width: '1.25em', height: '1.25em' }
  if (!url || failed === url) {
    return (
      <span className={`inline-block text-center leading-none ${className}`} style={{ ...box, fontSize: size ? size * 0.85 : '1.1em' }}>
        {emoji}
      </span>
    )
  }
  return (
    <img
      src={url}
      alt={emoji}
      draggable={false}
      loading="lazy"
      onError={() => setFailed(url)}
      className={`inline-block align-[-0.25em] ${className}`}
      style={box}
    />
  )
}

/** Text with its emojis drawn by Emoji (`size` as there). */
export function EmojiText({ text, size }: { text: string; size?: number }): ReactNode {
  return splitEmoji(text).map((part, i) => (typeof part === 'string' ? part : <Emoji key={i} emoji={part.emoji} size={size} />))
}

// --- Picker ----------------------------------------------------------------------------------

// By emojibase group (2, the components, isn't shown).
const GROUP_ICONS: Record<number, LucideIcon> = { 0: Smile, 1: Hand, 3: PawPrint, 4: Apple, 5: Car, 6: Gamepad2, 7: Lightbulb, 8: Heart, 9: Flag }
const RECENT = -1
const TONE_SAMPLE = '✋'

/** The message box's picker also has stickers, for the place it sends to. */
export interface StickerTarget {
  /** null: a DM or group (only Aureum's stickers go there). */
  serverId: string | null
  onPick(sticker: Sticker): void
}

type PickerTab = 'emoji' | 'stickers'

interface PickerState {
  open: { x: number; y: number; onPick(emoji: string): void; stickers?: StickerTarget } | null
  tab: PickerTab
}

const usePicker = create<PickerState>()(() => ({ open: null, tab: 'emoji' }))

/** Opens the emoji picker next to `anchor`; `onPick` gets the chosen emoji (in the user's tone).
 * With `stickers`, it also has a "Figurinhas" tab. One picker at a time, rendered by
 * <EmojiPickerHost />. */
export function pickEmoji(anchor: Element, onPick: (emoji: string) => void, options: { stickers?: StickerTarget } = {}): void {
  const rect = anchor.getBoundingClientRect()
  usePicker.setState({ open: { x: rect.right, y: rect.top, onPick, stickers: options.stickers }, tab: 'emoji' })
}

export const closeEmojiPicker = (): void => usePicker.setState({ open: null })

/** The catalog, once loaded. */
export function useEmojiCatalog(): EmojiCatalog | null {
  const [catalog, setCatalog] = useState<EmojiCatalog | null>(null)
  useEffect(() => {
    let alive = true
    void loadEmojis().then((c) => alive && setCatalog(c))
    return () => {
      alive = false
    }
  }, [])
  return catalog
}

/** Remembers an emoji as recently used (on every PC: it's in the user's settings). */
export function rememberEmoji(emoji: string): void {
  const { settings, update } = useAppearance.getState()
  update({ recent_emojis: withRecent(settings.recent_emojis, emoji) })
}

export function EmojiPickerHost(): ReactNode {
  const open = usePicker((s) => s.open)
  const tab = usePicker((s) => s.tab)
  if (!open) return null
  const { stickers } = open
  return createPortal(
    <PickerFrame x={open.x} y={open.y} tall={!!stickers}>
      {stickers && (
        <div role="tablist" className="flex gap-1 border-b border-line px-2 pt-2">
          {(
            [
              ['emoji', 'Emojis'],
              ['stickers', 'Figurinhas']
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => usePicker.setState({ tab: key })}
              className={`-mb-px border-b-2 px-3 pb-1.5 text-sm font-medium ${tab === key ? 'border-accent text-fg' : 'border-transparent text-fg-subtle hover:text-fg'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {stickers && tab === 'stickers' ? (
        <StickerPanel
          serverId={stickers.serverId}
          onPick={(sticker) => {
            stickers.onPick(sticker)
            closeEmojiPicker()
          }}
        />
      ) : (
        <EmojiPanel onPick={open.onPick} />
      )}
    </PickerFrame>,
    document.body
  )
}

const PICKER_W = 352
const PICKER_H = 420
// With tabs (the message box's picker).
const PICKER_TALL_H = 460

/** The popover: above the anchor, ending at its right edge, kept inside the window. Outside click
 * or Esc closes it, and only it (not a modal it was opened from). */
function PickerFrame({ x, y, tall, children }: { x: number; y: number; tall: boolean; children: ReactNode }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const height = tall ? PICKER_TALL_H : PICKER_H
  const [pos, setPos] = useState({ left: x - PICKER_W, top: y - height - 8 })

  useLayoutEffect(() => {
    setPos({
      left: Math.max(8, Math.min(x - PICKER_W, window.innerWidth - PICKER_W - 8)),
      top: y - height - 8 >= 8 ? y - height - 8 : Math.min(y + 32, window.innerHeight - height - 8)
    })
  }, [x, y, height])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) closeEmojiPicker()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeEmojiPicker()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Escolher emoji"
      style={{ ...pos, width: PICKER_W, height }}
      className={cn(menuClass, 'app-no-drag fixed z-[70] flex flex-col p-0')}
    >
      {children}
    </div>
  )
}

function EmojiPanel({ onPick }: { onPick(emoji: string): void }): ReactNode {
  const list = useRef<HTMLDivElement>(null)
  const catalog = useEmojiCatalog()
  const tone = useAppearance((s) => s.settings.emoji_tone) as SkinTone
  const recent = useAppearance((s) => s.settings.recent_emojis)
  const [query, setQuery] = useState('')
  const [hovered, setHovered] = useState<EmojiEntry | null>(null)
  const [tones, setTones] = useState(false)

  const results = useMemo(() => (catalog && query.trim() ? searchEmojis(catalog, query, 120) : null), [catalog, query])
  const recentEntries = useMemo(
    () => (catalog ? recent.map((e) => ({ emoji: e, entry: catalog.byEmoji.get(e) })).filter((r) => r.entry) : []),
    [catalog, recent]
  )

  const pick = (emoji: string): void => {
    rememberEmoji(emoji)
    onPick(emoji)
    closeEmojiPicker()
  }
  const jump = (group: number): void => {
    list.current?.querySelector(`[data-group="${group}"]`)?.scrollIntoView({ block: 'start' })
  }
  const cell = (entry: EmojiEntry, emoji = withTone(entry, tone)): ReactNode => (
    <button
      key={emoji}
      type="button"
      aria-label={entry.label}
      onClick={() => pick(emoji)}
      onMouseEnter={() => setHovered(entry)}
      onFocus={() => setHovered(entry)}
      className="flex h-9 w-9 items-center justify-center rounded-item hover:bg-elevated focus-visible:bg-elevated"
    >
      <Emoji emoji={emoji} size={26} />
    </button>
  )

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line p-2">
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar emoji"
            aria-label="Buscar emoji"
            className={cn(inputClass, 'py-1.5 pl-8 text-sm')}
          />
        </div>
        <div className="relative">
          <button
            type="button"
            title="Tom de pele"
            aria-label="Tom de pele"
            aria-expanded={tones}
            onClick={() => setTones((t) => !t)}
            className="flex h-8 w-8 items-center justify-center rounded-item hover:bg-elevated"
          >
            <Emoji emoji={catalog ? withTone(catalog.byEmoji.get(TONE_SAMPLE)!, tone) : TONE_SAMPLE} size={22} />
          </button>
          {tones && catalog && (
            <div role="radiogroup" aria-label="Tom de pele" className={cn(menuClass, 'absolute right-0 top-9 flex gap-0.5 p-1')}>
              {([0, 1, 2, 3, 4, 5] as SkinTone[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={t === tone}
                  aria-label={`Tom ${t}`}
                  onClick={() => {
                    useAppearance.getState().update({ emoji_tone: t })
                    setTones(false)
                  }}
                  className={`flex h-8 w-8 items-center justify-center rounded-item hover:bg-elevated ${t === tone ? 'bg-elevated' : ''}`}
                >
                  <Emoji emoji={withTone(catalog.byEmoji.get(TONE_SAMPLE)!, t)} size={22} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!results && catalog && (
        <div className="flex justify-between border-b border-line px-1.5 py-1 text-fg-subtle">
          {[{ id: RECENT, label: 'Recentes' }, ...catalog.groups].map((g) => {
            const Icon = g.id === RECENT ? Clock : (GROUP_ICONS[g.id] ?? Smile)
            if (g.id === RECENT && !recentEntries.length) return null
            return (
              <button key={g.id} type="button" title={g.label} aria-label={g.label} onClick={() => jump(g.id)} className="rounded-item p-1.5 hover:bg-elevated hover:text-fg">
                <Icon size={16} />
              </button>
            )
          })}
        </div>
      )}

      <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!catalog ? (
          <p className="py-8 text-center text-sm text-fg-subtle">Carregando…</p>
        ) : results ? (
          results.length ? (
            <div className="grid grid-cols-8 pt-2">{results.map((e) => cell(e))}</div>
          ) : (
            <p className="py-8 text-center text-sm text-fg-subtle">Nenhum emoji encontrado.</p>
          )
        ) : (
          <>
            {recentEntries.length > 0 && (
              <section data-group={RECENT}>
                <h3 className="sticky top-0 bg-main pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Recentes</h3>
                <div className="grid grid-cols-8">{recentEntries.map((r) => cell(r.entry!, r.emoji))}</div>
              </section>
            )}
            {catalog.groups.map((g) => (
              <section key={g.id} data-group={g.id}>
                <h3 className="sticky top-0 bg-main pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{g.label}</h3>
                <div className="grid grid-cols-8">{catalog.entries.filter((e) => e.group === g.id).map((e) => cell(e))}</div>
              </section>
            ))}
          </>
        )}
      </div>

      <p className="flex h-9 shrink-0 items-center gap-2 truncate border-t border-line px-3 text-sm text-fg-muted">
        {hovered ? (
          <>
            <Emoji emoji={withTone(hovered, tone)} size={20} />
            <span className="truncate">{hovered.label}</span>
            {hovered.words[0] && <span className="truncate text-xs text-fg-subtle">:{hovered.words[0]}:</span>}
          </>
        ) : (
          <span className="text-fg-subtle">Emojis por Twemoji</span>
        )}
      </p>
    </>
  )
}

// --- ":fogo" autocomplete ---------------------------------------------------------------------

const SUGGESTIONS = 8

/**
 * Suggestions while typing ":" + 2 letters in a text box: ↑/↓ to choose, Enter or Tab to put the
 * emoji in place of ":fogo", Esc to close. `onKeyDown` returns true when it used the key.
 */
export function useEmojiAutocomplete(
  text: string,
  caret: number,
  replace: (start: number, end: number, emoji: string) => void
): { popup: ReactNode; onKeyDown(e: { key: string; preventDefault(): void }): boolean } {
  const tone = useAppearance((s) => s.settings.emoji_tone) as SkinTone
  const [catalog, setCatalog] = useState<EmojiCatalog | null>(null)
  const [active, setActive] = useState(0)
  const [closedAt, setClosedAt] = useState<number | null>(null)
  const query = emojiQueryAt(text, caret)
  useEffect(() => {
    if (query && !catalog) void loadEmojis().then(setCatalog)
  }, [query, catalog])
  useEffect(() => setActive(0), [query?.query])
  const found = query && catalog && closedAt !== query.start ? searchEmojis(catalog, query.query, SUGGESTIONS) : []

  const choose = (entry: EmojiEntry): void => {
    const emoji = withTone(entry, tone)
    rememberEmoji(emoji)
    replace(query!.start, caret, emoji)
  }
  const onKeyDown = (e: { key: string; preventDefault(): void }): boolean => {
    if (!found.length) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      choose(found[active])
    } else if (e.key === 'Escape') {
      setClosedAt(query!.start)
    } else return false
    e.preventDefault()
    return true
  }
  const popup = found.length ? (
    <ul role="listbox" aria-label="Emojis" className={cn(menuClass, 'absolute bottom-full left-0 mb-2 w-72')}>
      {found.map((entry, i) => (
        <li key={entry.emoji} role="option" aria-selected={i === active}>
          <button
            type="button"
            // mousedown, not click: the text box keeps focus and the caret.
            onMouseDown={(e) => {
              e.preventDefault()
              choose(entry)
            }}
            onMouseEnter={() => setActive(i)}
            className={`flex w-full items-center gap-2.5 rounded-item px-2 py-1 text-left text-sm ${i === active ? 'bg-elevated text-fg' : 'text-fg-muted'}`}
          >
            <Emoji emoji={withTone(entry, tone)} size={20} />
            <span className="truncate">:{entry.words[0] ?? entry.label}:</span>
          </button>
        </li>
      ))}
    </ul>
  ) : null
  return { popup, onKeyDown }
}
