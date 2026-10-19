/**
 * Renders the PNGs the account e-mails use (Gmail doesn't show SVG), at 2x:
 *   apps/api/app/static/email/logo.png      28 px in the e-mail -> 56 px
 *   apps/api/app/static/email/pioneiro.png  132 px in the e-mail -> 264 px, with its gold glow
 *
 * Uses the Electron the desktop app already has (offscreen window + capturePage), so the glow
 * is the same CSS drop-shadow the app draws. The Pioneiro art is read from apps/api/app/badges.py,
 * so swapping the badge's art there and running this again updates the e-mail.
 *
 *   apps/desktop/node_modules/.bin/electron scripts/generate-email-images.mjs
 *   (or `npm run email-images` in apps/desktop; from a VS Code terminal, unset ELECTRON_RUN_AS_NODE first)
 */
import { app, BrowserWindow } from 'electron'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'apps/api/app/static/email')

// The mark from docs/design/emails/Invite.dc.html.
const LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><polygon points="48,8 82.6,28 82.6,68 48,88 13.4,68 13.4,28" fill="none" stroke="#E8B531" stroke-width="8" stroke-linejoin="round"/><path d="M48 26 L66 70 H56 L48 50 L40 70 H30 Z" fill="#E8B531"/></svg>'

function pioneerSvg() {
  const source = readFileSync(join(ROOT, 'apps/api/app/badges.py'), 'utf8')
  const entry = source.slice(source.indexOf('key=PIONEER'))
  const match = entry.match(/icon_svg='(<svg[^']+<\/svg>)'/)
  if (!match) throw new Error('Pioneiro art not found in apps/api/app/badges.py')
  return match[1]
}

// The diagonal shine of mythic badges, frozen halfway across and clipped to the hexagon.
const SHINE = `
  <svg viewBox="0 0 96 96" style="position:absolute;inset:0;width:100%;height:100%">
    <defs>
      <clipPath id="hex"><polygon points="48,10 80.9,29 80.9,67 48,86 15.1,67 15.1,29"/></clipPath>
      <linearGradient id="band" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0.38" stop-color="#fff" stop-opacity="0"/>
        <stop offset="0.48" stop-color="#fff" stop-opacity="0.22"/>
        <stop offset="0.58" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="96" height="96" fill="url(#band)" clip-path="url(#hex)"/>
  </svg>`

const IMAGES = [
  { file: 'logo.png', size: 56, html: `<div style="width:56px;height:56px">${LOGO}</div>` },
  {
    file: 'pioneiro.png',
    size: 264,
    html: `<div style="width:264px;height:264px;display:flex;align-items:center;justify-content:center">
      <div style="position:relative;width:208px;height:208px;filter:drop-shadow(0 0 22px rgba(232,181,49,.55))">
        ${pioneerSvg()}${SHINE}
      </div></div>`
  }
]

async function render(win, { size, html }) {
  win.setContentSize(size, size)
  const page = `<!doctype html><html><head><style>
    html,body{margin:0;background:transparent;overflow:hidden} svg{display:block;width:100%;height:100%}
  </style></head><body>${html}</body></html>`
  const dir = mkdtempSync(join(tmpdir(), 'aureum-email-'))
  writeFileSync(join(dir, 'page.html'), page)
  await win.loadFile(join(dir, 'page.html'))
  rmSync(dir, { recursive: true, force: true })
  await new Promise((resolve) => setTimeout(resolve, 300)) // let the offscreen frame paint
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  return image.resize({ width: size, height: size }).toPNG()
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    mkdirSync(OUT_DIR, { recursive: true })
    // One window for all: a second offscreen window fails to load on Windows.
    const win = new BrowserWindow({
      width: 264, height: 264, useContentSize: true, show: false, frame: false, transparent: true,
      webPreferences: { offscreen: true }
    })
    for (const image of IMAGES) {
      const png = await render(win, image)
      writeFileSync(join(OUT_DIR, image.file), png)
      console.log(`${image.file}: ${png.length} bytes`)
    }
    app.quit()
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
