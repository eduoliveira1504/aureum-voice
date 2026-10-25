// What makes a grapheme an emoji: a pictograph, a flag letter or a keycap (1️⃣).
const EMOJI_GRAPHEME = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u

const graphemes = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' })

/** The last emoji typed or pasted into a one-emoji field, dropping anything else ("a🍕b" gives
 * "🍕"; plain text gives ""). */
export function lastEmoji(value: string): string {
  let found = ''
  for (const { segment } of graphemes.segment(value)) if (EMOJI_GRAPHEME.test(segment)) found = segment
  return found
}
