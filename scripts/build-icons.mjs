/**
 * Builds every app icon from the two official logos (docs/design/brand):
 *   logo-small.svg up to 24px, logo.svg from 32px up.
 *
 *   apps/desktop/build/icon.ico        exe, installer, uninstaller, shortcut and window
 *                                      (16, 24, 32, 48, 64, 128, 256)
 *   apps/desktop/resources/tray-N.png  tray icon at 100/125/150/200% (16, 20, 24, 32; logo-small)
 *
 * Uses the Electron the desktop app already has: each size is drawn from the SVG straight onto
 * a canvas of that size (sharp edges at 16px, no downscaling). The .ico is written by hand:
 * sizes below 256 as 32-bit bitmaps (what the Windows shell and NSIS read best), 256 as PNG.
 *
 *   npm run build:icons (in apps/desktop; from a VS Code terminal, unset ELECTRON_RUN_AS_NODE first)
 */
import { app, BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRAND = join(ROOT, 'docs', 'design', 'brand')
const DESKTOP = join(ROOT, 'apps', 'desktop')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const TRAY_SIZES = [16, 20, 24, 32]
const SMALL_UP_TO = 24

const svgFor = (size, forceSmall = false) =>
  readFileSync(join(BRAND, forceSmall || size <= SMALL_UP_TO ? 'logo-small.svg' : 'logo.svg'), 'utf8')

/** Draws the SVG at size x size in the page; returns the PNG and the raw RGBA pixels. */
async function render(win, svg, size) {
  const { png, rgba } = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))}
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = ${size}
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, ${size}, ${size})
    return {
      png: canvas.toDataURL('image/png').split(',')[1],
      rgba: Array.from(ctx.getImageData(0, 0, ${size}, ${size}).data)
    }
  })()`)
  return { size, png: Buffer.from(png, 'base64'), rgba: Uint8Array.from(rgba) }
}

/** A 32-bit DIB icon entry: header, BGRA rows bottom-up, then an empty AND mask. */
function bitmapEntry({ size, rgba }) {
  const maskRow = Math.ceil(size / 32) * 4
  const out = Buffer.alloc(40 + size * size * 4 + maskRow * size)
  out.writeUInt32LE(40, 0)
  out.writeInt32LE(size, 4)
  out.writeInt32LE(size * 2, 8) // color + mask
  out.writeUInt16LE(1, 12)
  out.writeUInt16LE(32, 14)
  out.writeUInt32LE(size * size * 4 + maskRow * size, 20)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4
      const to = 40 + ((size - 1 - y) * size + x) * 4
      out[to] = rgba[from + 2]
      out[to + 1] = rgba[from + 1]
      out[to + 2] = rgba[from]
      out[to + 3] = rgba[from + 3]
    }
  }
  return out
}

function ico(images) {
  const entries = images.map((image) => (image.size >= 256 ? image.png : bitmapEntry(image)))
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach((image, i) => {
    const at = 6 + 16 * i
    header[at] = image.size >= 256 ? 0 : image.size
    header[at + 1] = image.size >= 256 ? 0 : image.size
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(entries[i].length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += entries[i].length
  })
  return Buffer.concat([header, ...entries])
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false })
    await win.loadURL('about:blank')

    const icoImages = []
    for (const size of ICO_SIZES) icoImages.push(await render(win, svgFor(size), size))
    mkdirSync(join(DESKTOP, 'build'), { recursive: true })
    const icon = ico(icoImages)
    writeFileSync(join(DESKTOP, 'build', 'icon.ico'), icon)
    console.log(`build/icon.ico: ${ICO_SIZES.join(', ')} (${icon.length} bytes)`)

    mkdirSync(join(DESKTOP, 'resources'), { recursive: true })
    for (const size of TRAY_SIZES) {
      const { png } = await render(win, svgFor(size, true), size)
      writeFileSync(join(DESKTOP, 'resources', `tray-${size}.png`), png)
    }
    console.log(`resources/tray-N.png: ${TRAY_SIZES.join(', ')}`)
    app.quit()
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
