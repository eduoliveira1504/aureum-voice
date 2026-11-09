/**
 * Builds every app icon from the two official logos (docs/design/brand):
 *   logo-small.svg up to 24px, logo.svg from 32px up.
 *
 *   apps/desktop/build/icon.ico        exe, installer, uninstaller, shortcut and window
 *                                      (16, 24, 32, 48, 64, 128, 256)
 *   apps/desktop/resources/tray-N.png  tray icon at 100/125/150/200% (16, 20, 24, 32; logo-small)
 *   apps/desktop/build/icon.icns       macOS app icon (16 to 1024, PNG entries); the logo sits
 *                                      inside Apple's icon grid (~80%) like other Dock icons
 *   apps/desktop/resources/trayTemplate.png, trayTemplate@2x.png
 *                                      macOS menu bar icon (16, 32; logo-small): black with
 *                                      alpha, macOS tints it for light and dark menu bars
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
// [type, size]: the PNG-based icns entries macOS reads (the @2x ones are the next size up).
const ICNS_ENTRIES = [
  ['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64], ['ic07', 128],
  ['ic13', 256], ['ic08', 256], ['ic14', 512], ['ic09', 512], ['ic10', 1024]
]
const ICNS_SCALE = 0.8

const svgFor = (size, forceSmall = false) =>
  readFileSync(join(BRAND, forceSmall || size <= SMALL_UP_TO ? 'logo-small.svg' : 'logo.svg'), 'utf8')

/**
 * Draws the SVG at size x size in the page; returns the PNG and the raw RGBA pixels. `scale`
 * shrinks the drawing around the center (the macOS icon grid); `template` keeps only the alpha,
 * in black (macOS template images).
 */
async function render(win, svg, size, { scale = 1, template = false } = {}) {
  const { png, rgba } = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))}
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = ${size}
    const ctx = canvas.getContext('2d')
    const drawn = ${size} * ${scale}
    ctx.drawImage(img, (${size} - drawn) / 2, (${size} - drawn) / 2, drawn, drawn)
    if (${template}) {
      ctx.globalCompositeOperation = 'source-in'
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, ${size}, ${size})
    }
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

/** An .icns file: "icns" + total length, then each entry as type + length (header included) + PNG. */
function icns(entries) {
  const parts = entries.map(([type, png]) => {
    const header = Buffer.alloc(8)
    header.write(type, 0, 'ascii')
    header.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([header, png])
  })
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(8 + parts.reduce((sum, part) => sum + part.length, 0), 4)
  return Buffer.concat([header, ...parts])
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

    const pngs = new Map()
    for (const [, size] of ICNS_ENTRIES) {
      if (!pngs.has(size)) pngs.set(size, (await render(win, svgFor(size), size, { scale: ICNS_SCALE })).png)
    }
    const mac = icns(ICNS_ENTRIES.map(([type, size]) => [type, pngs.get(size)]))
    writeFileSync(join(DESKTOP, 'build', 'icon.icns'), mac)
    console.log(`build/icon.icns: ${[...pngs.keys()].join(', ')} (${mac.length} bytes)`)

    for (const [size, name] of [[16, 'trayTemplate.png'], [32, 'trayTemplate@2x.png']]) {
      const { png } = await render(win, svgFor(size, true), size, { template: true })
      writeFileSync(join(DESKTOP, 'resources', name), png)
    }
    console.log('resources/trayTemplate.png, trayTemplate@2x.png: 16, 32')
    app.quit()
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
