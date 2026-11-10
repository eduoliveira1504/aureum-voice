/**
 * Renders the landing page's synthetic screenshots into site/img/*.webp.
 *
 * Each scene is plain HTML/CSS in scripts/site-shots/ (bars instead of names, plain colored
 * circles instead of avatars, nothing from a real account). Uses the Electron the desktop app already
 * has, like generate-og-image.mjs: an offscreen window at 2x, captured and encoded as WebP by
 * Chromium's own canvas.
 *
 *   apps/desktop/node_modules/.bin/electron scripts/generate-site-shots.mjs [name ...]
 *   (or `npm run site-shots` in apps/desktop; from a VS Code terminal, unset ELECTRON_RUN_AS_NODE first)
 */
import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCENES = join(ROOT, 'scripts', 'site-shots')
const OUT = join(ROOT, 'site', 'img')
const SCALE = 2
const QUALITY = 0.86

// name -> CSS size of the scene (the file is SCALE times that).
const SHOTS = {
  paineis: [1120, 760],
  jogar: [1200, 760],
  trabalhar: [1200, 760],
  conversa: [880, 560],
  organiza: [880, 560],
  perfil: [880, 560]
}

async function render(name, [width, height]) {
  const win = new BrowserWindow({
    width: width * SCALE, height: height * SCALE, useContentSize: true, show: false, frame: false,
    webPreferences: { offscreen: true, zoomFactor: SCALE }
  })
  try {
    await win.loadFile(join(SCENES, `${name}.html`))
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
    await new Promise((resolve) => setTimeout(resolve, 600)) // let the offscreen frame paint
    const image = await win.webContents.capturePage()
    const png = image.toDataURL()
    const webp = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = ${width * SCALE}; canvas.height = ${height * SCALE}
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/webp', ${QUALITY}))
      }
      img.onerror = reject
      img.src = ${JSON.stringify(png)}
    })`)
    const bytes = Buffer.from(webp.split(',')[1], 'base64')
    writeFileSync(join(OUT, `${name}.webp`), bytes)
    console.log(`${name}.webp: ${width * SCALE}x${height * SCALE}, ${Math.round(bytes.length / 1024)} KB`)
  } finally {
    win.destroy()
  }
}

app.disableHardwareAcceleration()
app.on('window-all-closed', () => {}) // one window per shot: closing one must not quit
app.whenReady().then(async () => {
  try {
    const wanted = process.argv.slice(2).filter((arg) => arg in SHOTS)
    for (const name of wanted.length ? wanted : Object.keys(SHOTS)) await render(name, SHOTS[name])
    app.quit()
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
