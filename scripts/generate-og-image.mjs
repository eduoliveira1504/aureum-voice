/**
 * Renders the landing page's share preview (og:image), 1200x630, in the landing's look:
 *   site/img/og.png
 *
 * Uses the Electron the desktop app already has (offscreen window + capturePage), like
 * generate-email-images.mjs. The app screenshot on the right is site/img/salas.png.
 *
 *   apps/desktop/node_modules/.bin/electron scripts/generate-og-image.mjs
 *   (or `npm run og-image` in apps/desktop; from a VS Code terminal, unset ELECTRON_RUN_AS_NODE first)
 */
import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = join(ROOT, 'site')
const WIDTH = 1200
const HEIGHT = 630

const HEX =
  "url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='56'%20height='97'%20viewBox='0%200%2056%2097'%3E%3Cpath%20d='M28%200%20L56%2016%20L56%2048%20L28%2064%20L0%2048%20L0%2016%20Z%20M28%2064%20L28%2097'%20fill='none'%20stroke='%23E8B531'%20stroke-opacity='0.08'%20stroke-width='1'/%3E%3C/svg%3E\")"

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=Figtree:wght@500;700&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body {
    background: radial-gradient(ellipse 700px 500px at 80% 40%, rgba(232,181,49,.18), transparent 70%), ${HEX}, #0E0D0B;
    color: #F4EFE4; font-family: Figtree, "Segoe UI", sans-serif; position: relative;
  }
  .bar { height: 6px; background: linear-gradient(90deg, #8A6410, #E8B531, #F4CF6A, #E8B531, #8A6410); }
  .copy { position: absolute; left: 72px; top: 76px; width: 560px; }
  .brand { display: flex; align-items: center; gap: 12px; color: #E8B531; font: 700 22px Sora; letter-spacing: .24em; }
  .brand svg { width: 38px; height: 38px; }
  .pill { display: inline-flex; gap: 8px; align-items: center; margin-top: 40px; padding: 8px 16px; border-radius: 999px;
    background: #1E1A10; box-shadow: 0 0 0 1px #5A4413; font-size: 14px; font-weight: 700; letter-spacing: .12em; color: #E8B531; }
  .pill i { width: 8px; height: 8px; border-radius: 50%; background: #7FBF7A; }
  h1 { margin: 22px 0 0; font: 700 54px/1.08 Sora; letter-spacing: -.02em; }
  h1 span { color: #E8B531; }
  p { margin: 22px 0 0; font-size: 21px; color: #D9D2C3; }
  .shot { position: absolute; left: 690px; top: 120px; width: 640px; border-radius: 16px; overflow: hidden;
    box-shadow: 0 0 0 1px #3A352A, 0 30px 70px rgba(0,0,0,.65), 0 0 100px rgba(232,181,49,.16);
    transform: perspective(1400px) rotateY(-14deg) rotateX(4deg); transform-origin: left center; }
  .shot img { display: block; width: 100%; }
</style></head><body>
<div class="bar"></div>
<div class="copy">
  <div class="brand"><svg viewBox="0 0 96 96"><polygon points="48,8 82.6,28 82.6,68 48,88 13.4,68 13.4,28" fill="none" stroke="#E8B531" stroke-width="8" stroke-linejoin="round"/><path d="M48 26 L66 70 H56 L48 50 L40 70 H30 Z" fill="#E8B531"/></svg>AUREUM</div>
  <div class="pill"><i></i>BETA FECHADO · SÓ COM CONVITE</div>
  <h1>Voz, chat e quadros pra quem joga e <span>trabalha junto.</span></h1>
  <p>Sem anúncio, sem IA e com personalização grátis.</p>
</div>
<div class="shot"><img src="${pathToFileURL(join(SITE, 'img', 'salas.png')).href}"></div>
</body></html>`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      width: WIDTH, height: HEIGHT, useContentSize: true, show: false, frame: false,
      webPreferences: { offscreen: true }
    })
    const file = join(app.getPath('temp'), 'aureum-og.html')
    writeFileSync(file, PAGE)
    await win.loadFile(file)
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
    await new Promise((resolve) => setTimeout(resolve, 500)) // let the offscreen frame paint
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: WIDTH, height: HEIGHT })
    const png = image.resize({ width: WIDTH, height: HEIGHT }).toPNG()
    writeFileSync(join(SITE, 'img', 'og.png'), png)
    console.log(`og.png: ${png.length} bytes`)
    app.quit()
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
