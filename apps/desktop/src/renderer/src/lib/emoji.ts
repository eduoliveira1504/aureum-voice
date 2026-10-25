/**
 * Emojis: telling them apart in text, Twemoji's drawing for each (the same on every PC, shipped
 * with the app at twemoji/, see electron.vite.config.ts) and the catalog the picker and the
 * ":fogo" autocomplete search, with Portuguese names (emojibase-data, loaded on first use).
 */

import twemojiNames from 'virtual:twemoji-names'

const DRAWN = new Set(twemojiNames)

// A grapheme that shows as an emoji: one drawn as emoji by default, a symbol asking for the emoji
// look (U+FE0F), a flag, a keycap (1\uFE0F\u20E3), a skin tone or a ZWJ sequence. Plain "©" or digits aren't.
const EMOJI_GRAPHEME = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|\p{Regional_Indicator}{2}|\u20E3|\p{Emoji_Modifier}|\u200D/u

const graphemes = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' })

export const isEmoji = (grapheme: string): boolean => EMOJI_GRAPHEME.test(grapheme)

/** Text cut into plain runs and single emojis. */
export function splitEmoji(text: string): (string | { emoji: string })[] {
  const out: (string | { emoji: string })[] = []
  let run = ''
  for (const { segment } of graphemes.segment(text)) {
    if (!isEmoji(segment)) {
      run += segment
      continue
    }
    if (run) out.push(run)
    run = ''
    out.push({ emoji: segment })
  }
  if (run) out.push(run)
  return out
}

/** A message that is only 1 to 3 emojis (spaces aside) shows them big. */
export function isEmojiOnly(text: string): boolean {
  const parts = splitEmoji(text.trim()).filter((p) => typeof p !== 'string' || p.trim())
  return parts.length >= 1 && parts.length <= 3 && parts.every((p) => typeof p !== 'string')
}

const hex = (text: string): string => [...text].map((c) => c.codePointAt(0)!.toString(16)).join('-')

/** Twemoji's drawing of an emoji, or null when it has none (emojis newer than Twemoji show as
 * the system draws them). Files are named by code point, without U+FE0F outside ZWJ sequences,
 * with some exceptions: hence the second try. */
export function twemojiUrl(emoji: string): string | null {
  const rule = hex(emoji.includes('\u200D') ? emoji : emoji.replace(/\uFE0F/g, ''))
  const bare = hex(emoji.replace(/\uFE0F/g, ''))
  const name = DRAWN.has(rule) ? rule : DRAWN.has(bare) ? bare : null
  return name && `twemoji/${name}.svg`
}

// --- Catalog ---------------------------------------------------------------------------------

/** Skin tones: 0 is the default yellow, 1-5 light to dark (the order of emojibase's skins). */
export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5

export interface EmojiEntry {
  emoji: string
  /** Portuguese name ("polegar para cima"). */
  label: string
  /** Search words: shortcodes ("polegar_para_cima") and tags ("joia", "valeu"), folded. */
  words: string[]
  group: number
  /** Versions with a skin tone, by tone (1-5). */
  tones?: string[]
}

export interface EmojiGroup {
  id: number
  label: string
}

export interface EmojiCatalog {
  entries: EmojiEntry[]
  groups: EmojiGroup[]
  /** Any emoji (with or without a tone) to its entry. */
  byEmoji: Map<string, EmojiEntry>
}

interface CompactEmoji {
  hexcode: string
  label: string
  unicode: string
  group?: number
  order?: number
  tags?: string[]
  skins?: { unicode: string; hexcode: string }[]
}

// emojibase's "component" group (bare skin tones and hair) isn't for picking.
const COMPONENT_GROUP = 2

/** Lowercase without accents, for matching what people type. */
export const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')

let catalog: Promise<EmojiCatalog> | null = null

/** The catalog, loaded once (a separate chunk: it only arrives when first needed). */
export function loadEmojis(): Promise<EmojiCatalog> {
  catalog ??= Promise.all([
    import('emojibase-data/pt/compact.json'),
    import('emojibase-data/pt/messages.json'),
    import('emojibase-data/pt/shortcodes/cldr.json')
  ]).then(([data, messages, shortcodes]) => {
    const codes = shortcodes.default as Record<string, string | string[]>
    // Only what Twemoji draws: the picker doesn't offer emojis that look different on each PC.
    const entries = (data.default as CompactEmoji[])
      .filter((e) => e.group !== undefined && e.group !== COMPONENT_GROUP && twemojiUrl(e.unicode))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((e): EmojiEntry => {
        const own = codes[e.hexcode] ?? []
        return {
          emoji: e.unicode,
          label: e.label,
          words: [...new Set([...(Array.isArray(own) ? own : [own]), ...(e.tags ?? [])].map(fold))],
          group: e.group!,
          tones: e.skins?.length === 5 && e.skins.every((s) => twemojiUrl(s.unicode)) ? e.skins.map((s) => s.unicode) : undefined
        }
      })
    const byEmoji = new Map<string, EmojiEntry>()
    for (const entry of entries) {
      byEmoji.set(entry.emoji, entry)
      for (const toned of entry.tones ?? []) byEmoji.set(toned, entry)
    }
    const groups = (messages.default.groups as { message: string; order: number }[])
      .filter((g) => g.order !== COMPONENT_GROUP)
      .map((g) => ({ id: g.order, label: g.message[0].toLocaleUpperCase('pt-BR') + g.message.slice(1) }))
    return { entries, groups, byEmoji }
  })
  return catalog
}

/** The entry's emoji in the user's tone (when it has tones). */
export const withTone = (entry: EmojiEntry, tone: SkinTone): string => (tone && entry.tones ? entry.tones[tone - 1] : entry.emoji)

/**
 * Emojis matching what was typed ("fogo", "polegar", "joia"), best first: the exact name or
 * shortcode, then one starting with it (shorter first: "fog" gives fogo before foguete), then a
 * word of the name or a tag starting with it, then anywhere.
 */
export function searchEmojis(cat: EmojiCatalog, query: string, limit = 50): EmojiEntry[] {
  const q = fold(query.trim()).replace(/\s+/g, '_')
  if (!q) return []
  const spaced = q.replace(/_/g, ' ')
  const scored: [number, number, EmojiEntry][] = []
  for (const entry of cat.entries) {
    const label = fold(entry.label)
    const name = entry.words[0] ?? label
    let score = 0
    if (name === q || label === spaced) score = 4
    else if (name.startsWith(q) || label.startsWith(spaced)) score = 3
    else if (label.split(/[\s:]+/).some((w) => w.startsWith(spaced)) || entry.words.some((w) => w.startsWith(q))) score = 2
    else if (label.includes(spaced) || entry.words.some((w) => w.includes(q))) score = 1
    if (score) scored.push([score, score === 3 ? name.length : 0, entry])
  }
  // Stable sort: ties keep the catalog's order (most common first).
  return scored
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .slice(0, limit)
    .map(([, , e]) => e)
}

/** What ":" + at least 2 letters before the cursor is asking for (":fog" → "fog"), or null. */
export function emojiQueryAt(text: string, caret: number): { query: string; start: number } | null {
  const match = /(^|\s):([\p{L}\p{N}_]{2,32})$/u.exec(text.slice(0, caret))
  return match ? { query: match[2], start: caret - match[2].length - 1 } : null
}

// Recently used emojis kept in the user's settings (newest first).
export const MAX_RECENT = 36

export const withRecent = (recent: string[], emoji: string): string[] => [emoji, ...recent.filter((e) => e !== emoji)].slice(0, MAX_RECENT)
