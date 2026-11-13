/**
 * Dates, times and numbers in the app's language (block 4.2.6). Formatters are cached per
 * language and options, so callers keep their options in a constant and ask here at render time:
 * `dateFormat(TIME).format(date)`. Components that format also call useTranslation(), which
 * re-renders them when the language changes.
 */
import { currentLocale } from './i18n'

const dates = new Map<string, Intl.DateTimeFormat>()
const numbers = new Map<string, Intl.NumberFormat>()
const segmenters = new Map<string, Intl.Segmenter>()

export function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${currentLocale()}|${JSON.stringify(options)}`
  let format = dates.get(key)
  if (!format) dates.set(key, (format = new Intl.DateTimeFormat(currentLocale(), options)))
  return format
}

export function numberFormat(options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${currentLocale()}|${JSON.stringify(options)}`
  let format = numbers.get(key)
  if (!format) numbers.set(key, (format = new Intl.NumberFormat(currentLocale(), options)))
  return format
}

/** Splits text into what a person sees as characters (emoji sequences stay whole). */
export function graphemes(): Intl.Segmenter {
  let segmenter = segmenters.get(currentLocale())
  if (!segmenter) segmenters.set(currentLocale(), (segmenter = new Intl.Segmenter(currentLocale(), { granularity: 'grapheme' })))
  return segmenter
}
