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

// --- OKLCH (perceptual lightness / chroma / hue), for re-tinting the neutral palette ---------

type Lch = [number, number, number] // L 0..1, C >= 0, h in degrees

const toLinear = (c: number): number => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const fromLinear = (c: number): number => {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
  return Math.min(255, Math.max(0, s * 255))
}

function toOklch(rgb: Rgb): Lch {
  const [r, g, b] = rgb.map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360]
}

function fromOklch([L, C, h]: Lch): Rgb {
  const A = C * Math.cos((h * Math.PI) / 180)
  const B = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  ]
}

/**
 * Moves a neutral palette color (designed around `reference`) to the hue of `accent`: lightness
 * stays, the hue turns by the same angle that separates accent from reference, and chroma scales
 * with the accent's (never above the original). With accent === reference it returns `base` as is;
 * a gray accent gives a plain gray.
 */
export function retint(base: string, accent: string, reference: string): string {
  const b = parseHex(base)
  const a = parseHex(accent)
  const r = parseHex(reference)
  if (!b || !a || !r) return base
  const [L, C, h] = toOklch(b)
  const [, accentC, accentH] = toOklch(a)
  const [, refC, refH] = toOklch(r)
  const scale = refC > 0 ? Math.min(1, accentC / refC) : 0
  return toHex(fromOklch([L, C * scale, (h + accentH - refH + 360) % 360]))
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
