/** Color math for the theme: WCAG 2.x contrast and readable variants of user-picked colors. */

type Rgb = [number, number, number]

const DARK_INK = '#1A1406'
const LIGHT_INK = '#FFFFFF'

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase()
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export function contrast(a: string, b: string): number {
  const x = parseHex(a)
  const y = parseHex(b)
  return x && y ? ratio(x, y) : 1
}

/** Text color for content placed on top of `background`: whichever ink contrasts more. */
export function inkOn(background: string): string {
  return contrast(DARK_INK, background) >= contrast(LIGHT_INK, background) ? DARK_INK : LIGHT_INK
}

/**
 * `color` adjusted to be readable as text on every one of `backgrounds` (at least `min`:1).
 * It is mixed toward black on light backgrounds and toward white on dark ones, in small steps,
 * so it keeps its hue and changes only as much as needed. Colors that already pass come back as is.
 */
export function readableOn(color: string, backgrounds: string[], min = 4.5): string {
  const start = parseHex(color)
  const bgs = backgrounds.map(parseHex).filter((c): c is Rgb => c !== null)
  if (!start || bgs.length === 0) return color
  const passes = (c: Rgb): boolean => bgs.every((bg) => ratio(c, bg) >= min)
  if (passes(start)) return toHex(start)

  const avgLum = bgs.reduce((sum, bg) => sum + luminance(bg), 0) / bgs.length
  const target: Rgb = avgLum > 0.18 ? [0, 0, 0] : [255, 255, 255]
  for (let t = 0.02; t <= 1; t += 0.02) {
    const mixed = start.map((c, i) => c + (target[i] - c) * t) as Rgb
    if (passes(mixed)) return toHex(mixed)
  }
  return toHex(target)
}
