import { describe, expect, it } from 'vitest'

import { emojiQueryAt, isEmojiOnly, loadEmojis, MAX_RECENT, searchEmojis, splitEmoji, twemojiUrl, withRecent, withTone } from './emoji'

describe('emojis in text', () => {
  it('tells emojis from text, keeping sequences whole', () => {
    expect(splitEmoji('oi 👍🏽 tudo 🇧🇷?')).toEqual(['oi ', { emoji: '👍🏽' }, ' tudo ', { emoji: '🇧🇷' }, '?'])
    expect(splitEmoji('❤️‍🔥')).toEqual([{ emoji: '❤️‍🔥' }])
    // Digits, © and ™ without the emoji look stay text.
    expect(splitEmoji('1 © 2026™')).toEqual(['1 © 2026™'])
  })

  it('shows 1 to 3 emojis alone big', () => {
    expect(isEmojiOnly('🔥')).toBe(true)
    expect(isEmojiOnly(' 😂 😂😂 ')).toBe(true)
    expect(isEmojiOnly('😂😂😂😂')).toBe(false)
    expect(isEmojiOnly('kkk 😂')).toBe(false)
    expect(isEmojiOnly('')).toBe(false)
  })

  it("finds Twemoji's file, with its naming exceptions", () => {
    expect(twemojiUrl('🔥')).toBe('twemoji/1f525.svg')
    expect(twemojiUrl('❤️')).toBe('twemoji/2764.svg')
    expect(twemojiUrl('❤️‍🔥')).toBe('twemoji/2764-fe0f-200d-1f525.svg')
    expect(twemojiUrl('👁️‍🗨️')).toBe('twemoji/1f441-200d-1f5e8.svg')
    // Newer than Twemoji: no drawing.
    expect(twemojiUrl('🫩')).toBeNull()
  })

  it('offers only emojis Twemoji draws, plenty of them', async () => {
    const { entries } = await loadEmojis()
    expect(entries.length).toBeGreaterThan(1800)
    expect(entries.flatMap((e) => [e.emoji, ...(e.tones ?? [])]).every((emoji) => twemojiUrl(emoji))).toBe(true)
  })
})

describe('emoji catalog', () => {
  it('searches in Portuguese, by name, shortcode and tag', async () => {
    const catalog = await loadEmojis()
    expect(searchEmojis(catalog, 'fogo')[0].emoji).toBe('🔥')
    expect(searchEmojis(catalog, 'fog')[0].emoji).toBe('🔥')
    expect(searchEmojis(catalog, 'polegar')[0].emoji).toBe('👍')
    expect(searchEmojis(catalog, 'joia').map((e) => e.emoji)).toContain('👍')
    expect(searchEmojis(catalog, 'coracao').map((e) => e.emoji)).toContain('❤️')
    expect(searchEmojis(catalog, 'xyzxyz')).toEqual([])
  })

  it('applies the skin tone where there is one', async () => {
    const { byEmoji } = await loadEmojis()
    expect(withTone(byEmoji.get('👍')!, 3)).toBe('👍🏽')
    expect(withTone(byEmoji.get('👍')!, 0)).toBe('👍')
    expect(withTone(byEmoji.get('🔥')!, 3)).toBe('🔥')
    // Categories without the components (bare tones, hair).
    expect((await loadEmojis()).groups.map((g) => g.id)).not.toContain(2)
  })

  it('reads ":" + 2 letters before the cursor', () => {
    expect(emojiQueryAt('que :fo', 7)).toEqual({ query: 'fo', start: 4 })
    expect(emojiQueryAt(':fogo', 5)).toEqual({ query: 'fogo', start: 0 })
    expect(emojiQueryAt('que :f', 6)).toBeNull()
    expect(emojiQueryAt('10:30', 5)).toBeNull()
    expect(emojiQueryAt('que :fogo agora', 15)).toBeNull()
  })

  it('keeps recent emojis newest first, without repeats', () => {
    expect(withRecent(['🔥', '👍'], '👍')).toEqual(['👍', '🔥'])
    expect(withRecent(Array.from({ length: MAX_RECENT }, (_, i) => String(i)), '🔥')).toHaveLength(MAX_RECENT)
  })
})
