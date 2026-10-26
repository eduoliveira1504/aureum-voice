/**
 * Builds the "Aureum básico" sticker pack: 16 stickers drawn here as SVG (a hexagon face, from the
 * logo's hexagon, with an expression and a word in Sora), exported as 320x320 PNGs.
 *
 *   docs/design/stickers/aureum-basico/*.svg          the drawings (sources)
 *   docs/design/stickers/aureum-basico/preview.png    all of them on one sheet, to review
 *   apps/api/app/static/stickers/aureum-basico/        PNGs + stickers.json (names, emojis), for the CLI:
 *     python -m app.cli stickers pack-add --nome "Aureum básico" --pasta app/static/stickers/aureum-basico
 *
 * Uses the Electron the desktop app already has (like build-icons.mjs). Sora is embedded while
 * rendering; the SVGs in docs only name it (the desktop app has it in @fontsource-variable/sora).
 *
 *   npm run build:stickers (in apps/desktop; from a VS Code terminal, unset ELECTRON_RUN_AS_NODE first)
 */
import { app, BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCES = join(ROOT, 'docs', 'design', 'stickers', 'aureum-basico')
const OUT = join(ROOT, 'apps', 'api', 'app', 'static', 'stickers', 'aureum-basico')
const SORA = readFileSync(join(ROOT, 'apps', 'desktop', 'node_modules', '@fontsource-variable', 'sora', 'files', 'sora-latin-wght-normal.woff2'))
const SIZE = 320

// Brand colors (docs/design/brand): the gold of the logo and a near-black ink.
const GOLD = '#E8B531'
const GOLD_DARK = '#C4921A'
const INK = '#1B1D23'
const WHITE = '#FFFFFF'
const BLUSH = '#F28B6B'
const TEAR = '#5BB8F0'
const RED = '#E5484D'

const hexPoints = (cx, cy, r) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`
  }).join(' ')

// The face sits at (160, 128); features are drawn around it.
const CX = 160
const CY = 128
const R = 96
const L = CX - 34 // left eye x
const RX = CX + 34 // right eye x
const EY = CY - 8 // eye line
const MY = CY + 34 // mouth line

const stroke = (w = 7) => `stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" fill="none"`

const eyes = {
  open: `<ellipse cx="${L}" cy="${EY}" rx="9" ry="12" fill="${INK}"/><ellipse cx="${RX}" cy="${EY}" rx="9" ry="12" fill="${INK}"/>
    <circle cx="${L + 3}" cy="${EY - 4}" r="3" fill="${WHITE}"/><circle cx="${RX + 3}" cy="${EY - 4}" r="3" fill="${WHITE}"/>`,
  happy: `<path d="M${L - 13} ${EY + 4} Q${L} ${EY - 12} ${L + 13} ${EY + 4}" ${stroke()}/><path d="M${RX - 13} ${EY + 4} Q${RX} ${EY - 12} ${RX + 13} ${EY + 4}" ${stroke()}/>`,
  closed: `<path d="M${L - 13} ${EY} Q${L} ${EY + 11} ${L + 13} ${EY}" ${stroke()}/><path d="M${RX - 13} ${EY} Q${RX} ${EY + 11} ${RX + 13} ${EY}" ${stroke()}/>`,
  squint: `<path d="M${L - 12} ${EY - 10} L${L + 10} ${EY} L${L - 12} ${EY + 10}" ${stroke()}/><path d="M${RX + 12} ${EY - 10} L${RX - 10} ${EY} L${RX + 12} ${EY + 10}" ${stroke()}/>`,
  sad: `<ellipse cx="${L}" cy="${EY + 2}" rx="8" ry="10" fill="${INK}"/><ellipse cx="${RX}" cy="${EY + 2}" rx="8" ry="10" fill="${INK}"/>
    <path d="M${L - 16} ${EY - 16} L${L + 10} ${EY - 22}" ${stroke(6)}/><path d="M${RX + 16} ${EY - 16} L${RX - 10} ${EY - 22}" ${stroke(6)}/>`,
  wide: `<circle cx="${L}" cy="${EY}" r="15" fill="${WHITE}" stroke="${INK}" stroke-width="6"/><circle cx="${RX}" cy="${EY}" r="15" fill="${WHITE}" stroke="${INK}" stroke-width="6"/>
    <circle cx="${L}" cy="${EY}" r="5" fill="${INK}"/><circle cx="${RX}" cy="${EY}" r="5" fill="${INK}"/>`,
  wink: `<ellipse cx="${L}" cy="${EY}" rx="9" ry="12" fill="${INK}"/><circle cx="${L + 3}" cy="${EY - 4}" r="3" fill="${WHITE}"/>
    <path d="M${RX - 13} ${EY + 2} Q${RX} ${EY - 10} ${RX + 13} ${EY + 2}" ${stroke()}/>`,
  hearts: [L, RX]
    .map((x) => `<path d="M${x} ${EY + 12} C${x - 22} ${EY - 2} ${x - 14} ${EY - 22} ${x} ${EY - 10} C${x + 14} ${EY - 22} ${x + 22} ${EY - 2} ${x} ${EY + 12} Z" fill="${RED}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`)
    .join(''),
  shades: `<path d="M${L - 26} ${EY - 12} H${RX + 26} V${EY - 4} Q${RX + 24} ${EY + 18} ${RX} ${EY + 16} Q${RX - 20} ${EY + 16} ${CX + 6} ${EY - 2} H${CX - 6} Q${L + 20} ${EY + 16} ${L} ${EY + 16} Q${L - 24} ${EY + 18} ${L - 26} ${EY - 4} Z" fill="${INK}"/>
    <path d="M${L - 12} ${EY - 6} L${L - 2} ${EY - 6}" stroke="${WHITE}" stroke-width="4" stroke-linecap="round"/><path d="M${RX - 12} ${EY - 6} L${RX - 2} ${EY - 6}" stroke="${WHITE}" stroke-width="4" stroke-linecap="round"/>`,
  calm: `<path d="M${L - 13} ${EY + 2} H${L + 13}" ${stroke()}/><path d="M${RX - 13} ${EY + 2} H${RX + 13}" ${stroke()}/>`,
  fierce: `<ellipse cx="${L}" cy="${EY + 4}" rx="8" ry="10" fill="${INK}"/><ellipse cx="${RX}" cy="${EY + 4}" rx="8" ry="10" fill="${INK}"/>
    <path d="M${L - 16} ${EY - 18} L${L + 12} ${EY - 8}" ${stroke(7)}/><path d="M${RX + 16} ${EY - 18} L${RX - 12} ${EY - 8}" ${stroke(7)}/>`
}

const mouths = {
  smile: `<path d="M${CX - 24} ${MY - 4} Q${CX} ${MY + 20} ${CX + 24} ${MY - 4}" ${stroke()}/>`,
  grin: `<path d="M${CX - 28} ${MY - 8} Q${CX} ${MY + 34} ${CX + 28} ${MY - 8} Z" fill="${INK}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M${CX - 14} ${MY + 10} Q${CX} ${MY + 2} ${CX + 14} ${MY + 10} Q${CX} ${MY + 20} ${CX - 14} ${MY + 10} Z" fill="${BLUSH}"/>`,
  laugh: `<path d="M${CX - 34} ${MY - 12} Q${CX} ${MY + 44} ${CX + 34} ${MY - 12} Z" fill="${INK}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M${CX - 18} ${MY + 14} Q${CX} ${MY + 4} ${CX + 18} ${MY + 14} Q${CX} ${MY + 28} ${CX - 18} ${MY + 14} Z" fill="${BLUSH}"/>`,
  frown: `<path d="M${CX - 22} ${MY + 10} Q${CX} ${MY - 10} ${CX + 22} ${MY + 10}" ${stroke()}/>`,
  flat: `<path d="M${CX - 18} ${MY + 2} H${CX + 18}" ${stroke()}/>`,
  o: `<ellipse cx="${CX}" cy="${MY + 6}" rx="14" ry="18" fill="${INK}"/>`,
  small: `<path d="M${CX - 12} ${MY} Q${CX} ${MY + 10} ${CX + 12} ${MY}" ${stroke(6)}/>`,
  awkward: `<path d="M${CX - 24} ${MY + 4} Q${CX - 12} ${MY - 6} ${CX} ${MY + 4} Q${CX + 12} ${MY + 14} ${CX + 24} ${MY + 2}" ${stroke()}/>`,
  smirk: `<path d="M${CX - 20} ${MY + 2} Q${CX + 6} ${MY + 14} ${CX + 26} ${MY - 8}" ${stroke()}/>`
}

const cheeks = `<ellipse cx="${L - 14}" cy="${MY - 6}" rx="11" ry="7" fill="${BLUSH}" opacity="0.7"/><ellipse cx="${RX + 14}" cy="${MY - 6}" rx="11" ry="7" fill="${BLUSH}" opacity="0.7"/>`
const tear = (x, y, s = 1) =>
  `<path d="M${x} ${y} Q${x + 10 * s} ${y + 16 * s} ${x} ${y + 24 * s} Q${x - 10 * s} ${y + 16 * s} ${x} ${y} Z" fill="${TEAR}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`
const sweat = `<path d="M${CX + 62} ${CY - 54} Q${CX + 76} ${CY - 32} ${CX + 66} ${CY - 22} Q${CX + 52} ${CY - 28} ${CX + 62} ${CY - 54} Z" fill="${TEAR}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`
const star = (x, y, r, fill = WHITE) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2
    const rr = i % 2 ? r * 0.45 : r
    return `${(x + rr * Math.cos(a)).toFixed(1)},${(y + rr * Math.sin(a)).toFixed(1)}`
  }).join(' ')
  return `<polygon points="${pts}" fill="${fill}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`
}
const heart = (x, y, s, fill = RED) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 14 C-26 -2 -16 -24 0 -10 C16 -24 26 -2 0 14 Z" fill="${fill}" stroke="${INK}" stroke-width="${4 / s}" stroke-linejoin="round"/>`

/** A line in ink with a white core, readable on light and dark chats. */
const lined = (d) =>
  `<path d="${d}" stroke="${INK}" stroke-width="13" stroke-linecap="round" fill="none"/><path d="${d}" stroke="${WHITE}" stroke-width="5" stroke-linecap="round" fill="none"/>`

// Things around the face (drawn behind it unless `front`).
const extras = {
  sun: `<g>${Array.from({ length: 8 }, (_, i) => {
    const a = (Math.PI / 4) * i
    const x1 = 252 + 30 * Math.cos(a), y1 = 50 + 30 * Math.sin(a), x2 = 252 + 44 * Math.cos(a), y2 = 50 + 44 * Math.sin(a)
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${INK}" stroke-width="12" stroke-linecap="round"/><path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${GOLD}" stroke-width="5" stroke-linecap="round"/>`
  }).join('')}<circle cx="252" cy="50" r="22" fill="${GOLD}" stroke="${INK}" stroke-width="5"/></g>`,
  moon: `<path d="M262 22 A34 34 0 1 0 292 74 A26 26 0 1 1 262 22 Z" fill="#F5E6B8" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>${star(56, 40, 13)}${star(84, 18, 8)}`,
  tears: `${tear(L - 4, EY + 12, 1.1)}${tear(RX + 4, EY + 12, 1.1)}`,
  tear: tear(L - 2, EY + 12),
  zzz: `<text x="236" y="58" font-size="40" font-weight="800" fill="${WHITE}" stroke="${INK}" stroke-width="7" paint-order="stroke" font-family="Sora">Z</text>
    <text x="268" y="34" font-size="28" font-weight="800" fill="${WHITE}" stroke="${INK}" stroke-width="6" paint-order="stroke" font-family="Sora">z</text>`,
  wave: lined('M262 46 Q276 58 268 76 M280 36 Q300 58 286 86'),
  party: `<path d="M126 60 L170 2 L196 70 Z" fill="${RED}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M150 28 L182 38" stroke="${WHITE}" stroke-width="6" stroke-linecap="round"/><circle cx="170" cy="6" r="10" fill="${GOLD}" stroke="${INK}" stroke-width="4"/>
    <rect x="44" y="64" width="12" height="20" rx="3" transform="rotate(-24 50 74)" fill="${TEAR}" stroke="${INK}" stroke-width="3"/>
    <rect x="262" y="96" width="12" height="20" rx="3" transform="rotate(28 268 106)" fill="${RED}" stroke="${INK}" stroke-width="3"/>
    <circle cx="276" cy="52" r="7" fill="${GOLD}" stroke="${INK}" stroke-width="3"/><circle cx="40" cy="128" r="6" fill="${BLUSH}" stroke="${INK}" stroke-width="3"/>`,
  flame: `<path d="M258 98 C230 98 224 72 236 56 C240 66 246 68 250 66 C244 46 254 28 270 18 C268 34 278 44 284 54 C292 68 288 98 258 98 Z" fill="#F07A2A" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M258 92 C246 92 244 80 250 72 C254 78 258 78 262 74 C266 82 270 92 258 92 Z" fill="${GOLD}"/>`,
  check: `<circle cx="258" cy="58" r="30" fill="#3FB37F" stroke="${INK}" stroke-width="5"/><path d="M244 58 L254 69 L273 47" stroke="${WHITE}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  hearts: `${heart(262, 46, 1.2)}${heart(58, 70, 0.8)}`,
  sweat,
  bolt: `<path d="M262 18 L238 64 H258 L246 104 L284 50 H262 L276 18 Z" fill="${GOLD}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`,
  arrow: `<path d="M240 52 H280 M266 38 L282 52 L266 66" stroke="${INK}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M240 52 H280 M266 38 L282 52 L266 66" stroke="${WHITE}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  question: `<text x="240" y="78" font-size="64" font-weight="800" fill="${WHITE}" stroke="${INK}" stroke-width="8" paint-order="stroke" font-family="Sora">?</text>`,
  breathe: lined('M236 44 Q248 34 260 44 T284 44 M244 66 Q256 56 268 66 T292 66')
}

/** One sticker: a face (eyes, mouth, extras) and its word. `face` tints the hexagon. */
const STICKERS = [
  { file: 'bom_dia', text: 'bom dia', emoji: '☀️', eyes: 'happy', mouth: 'smile', cheeks: true, behind: ['sun'] },
  { file: 'oi', text: 'oi!', emoji: '👋', eyes: 'open', mouth: 'grin', cheeks: true, front: ['wave'] },
  { file: 'kkkk', text: 'kkkk', emoji: '😂', eyes: 'squint', mouth: 'laugh', front: ['tears'], tilt: -6 },
  { file: 'gg', text: 'GG', emoji: '🎮', eyes: 'shades', mouth: 'smirk', front: ['bolt'], size: 78 },
  { file: 'bora', text: 'bora?', emoji: '🚀', eyes: 'open', mouth: 'grin', front: ['question'], tilt: 4 },
  { file: 'to_dentro', text: 'tô dentro', emoji: '👍', eyes: 'wink', mouth: 'grin', front: ['check'], size: 44 },
  { file: 'valeu', text: 'valeu!', emoji: '🙏', eyes: 'happy', mouth: 'smile', cheeks: true, front: ['hearts'] },
  { file: 'amei', text: 'amei', emoji: '😍', eyes: 'hearts', mouth: 'grin', cheeks: true, front: ['hearts'] },
  { file: 'brabo', text: 'brabo', emoji: '🔥', eyes: 'fierce', mouth: 'smirk', front: ['flame'], tilt: -4 },
  { file: 'parabens', text: 'parabéns', emoji: '🎉', eyes: 'happy', mouth: 'laugh', cheeks: true, front: ['party'], size: 46 },
  { file: 'triste', text: 'triste', emoji: '😢', eyes: 'sad', mouth: 'frown', front: ['tear'], face: '#D9B25A' },
  { file: 'socorro', text: 'socorro', emoji: '😱', eyes: 'wide', mouth: 'o', front: ['sweat'], tilt: 5, size: 50 },
  { file: 'calma', text: 'calma', emoji: '😌', eyes: 'calm', mouth: 'small', front: ['breathe'] },
  { file: 'foi_mal', text: 'foi mal', emoji: '😅', eyes: 'closed', mouth: 'awkward', cheeks: true, front: ['sweat'], size: 52 },
  { file: 'dormindo', text: 'dormindo', emoji: '😴', eyes: 'closed', mouth: 'small', front: ['zzz'], face: '#D9B25A', size: 46 },
  { file: 'boa_noite', text: 'boa noite', emoji: '🌙', eyes: 'closed', mouth: 'smile', cheeks: true, behind: ['moon'], face: '#D9B25A', size: 46 }
]

/** The drawing. With `font`, Sora goes inside it (an SVG drawn as an image can't load fonts). */
function svgOf(s, font = false) {
  const size = s.size ?? 58
  const face = s.face ?? GOLD
  // The white edge of a die-cut sticker: the same shapes, thicker, in white, behind everything.
  const outline = `<polygon points="${hexPoints(CX, CY, R)}" fill="${WHITE}" stroke="${WHITE}" stroke-width="34" stroke-linejoin="round"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
<defs>${font ? `<style>@font-face{font-family:Sora;font-weight:100 800;src:url(data:font/woff2;base64,${SORA.toString('base64')}) format('woff2')}</style>` : ''}
<filter id="shadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity="0.25"/></filter></defs>
<g filter="url(#shadow)">
${(s.behind ?? []).map((e) => extras[e]).join('\n')}
${outline}
<polygon points="${hexPoints(CX, CY, R)}" fill="${face}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
<polygon points="${hexPoints(CX, CY + 10, R - 18)}" fill="${GOLD_DARK}" opacity="0.18"/>
${s.cheeks ? cheeks : ''}
${eyes[s.eyes]}
${mouths[s.mouth]}
${(s.front ?? []).map((e) => extras[e]).join('\n')}
<g transform="rotate(${s.tilt ?? -3} 160 272)">
<text x="160" y="${272 + size * 0.34}" text-anchor="middle" font-family="Sora" font-weight="800" font-size="${size}" letter-spacing="-1"
  fill="${WHITE}" stroke="${INK}" stroke-width="${Math.round(size / 4.2)}" stroke-linejoin="round" paint-order="stroke">${s.text}</text>
</g>
</g>
</svg>`
}

async function render(win, svg, size) {
  const png = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))}
    await img.decode()
    await new Promise((r) => setTimeout(r, 50))
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = ${size}
    canvas.getContext('2d').drawImage(img, 0, 0, ${size}, ${size})
    return canvas.toDataURL('image/png').split(',')[1]
  })()`)
  return Buffer.from(png, 'base64')
}

/** All stickers on one sheet (4 per row, on a light and a dark band), to review them. */
async function sheet(win, pngs) {
  const cols = 4
  const cell = 200
  const rows = Math.ceil(pngs.length / cols)
  const data = await win.webContents.executeJavaScript(`(async () => {
    const pngs = ${JSON.stringify(pngs.map((p) => p.toString('base64')))}
    const canvas = document.createElement('canvas')
    canvas.width = ${cols * cell}
    canvas.height = ${rows * cell}
    const ctx = canvas.getContext('2d')
    for (let i = 0; i < pngs.length; i++) {
      const x = (i % ${cols}) * ${cell}, y = Math.floor(i / ${cols}) * ${cell}
      ctx.fillStyle = (Math.floor(i / ${cols}) + i) % 2 ? '#2B2D31' : '#F2F3F5'
      ctx.fillRect(x, y, ${cell}, ${cell})
      const img = new Image()
      img.src = 'data:image/png;base64,' + pngs[i]
      await img.decode()
      ctx.drawImage(img, x + 20, y + 20, 160, 160)
    }
    return canvas.toDataURL('image/png').split(',')[1]
  })()`)
  return Buffer.from(data, 'base64')
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('about:blank')
  mkdirSync(SOURCES, { recursive: true })
  mkdirSync(OUT, { recursive: true })
  const pngs = []
  for (const sticker of STICKERS) {
    writeFileSync(join(SOURCES, `${sticker.file}.svg`), svgOf(sticker))
    const png = await render(win, svgOf(sticker, true), SIZE)
    writeFileSync(join(OUT, `${sticker.file}.png`), png)
    pngs.push(png)
  }
  // The name people search for: the word without punctuation ("oi!" is "oi").
  const about = STICKERS.map((s) => [s.file, { name: s.text.toLowerCase().replace(/[!?]/g, ''), emoji: s.emoji }])
  writeFileSync(join(OUT, 'stickers.json'), JSON.stringify(Object.fromEntries(about), null, 2) + '\n')
  writeFileSync(join(SOURCES, 'preview.png'), await sheet(win, pngs))
  console.log(`${STICKERS.length} stickers in ${OUT}`)
  app.quit()
})
