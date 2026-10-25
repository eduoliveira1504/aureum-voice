import { readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

/**
 * `import data from './file.wasm?base64'` gives the file's bytes as a base64 string. The packaged
 * app loads from file://, where fetch() can't read files, so binaries it needs (the RNNoise
 * WebAssembly) are built into the bundle instead.
 */
function base64Import(): Plugin {
  return {
    name: 'aureum:base64-import',
    enforce: 'pre',
    async load(id) {
      const [file, query] = id.split('?')
      if (query !== 'base64') return null
      this.addWatchFile(file)
      return `export default ${JSON.stringify((await readFile(file)).toString('base64'))}`
    }
  }
}

const EXCALIDRAW_FONTS = resolve(__dirname, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts')
// Xiaolai (13 MB of Chinese handwriting) stays out; CJK text falls back to the system's fonts.
const SKIPPED_FONTS = new Set(['Xiaolai'])

/**
 * The whiteboard's fonts (Excalidraw's), shipped with the app at excalidraw/fonts/ instead of
 * coming from Excalidraw's CDN: served by the dev server and copied into the build.
 */
function excalidrawFonts(): Plugin {
  const files = async (): Promise<string[]> =>
    (await readdir(EXCALIDRAW_FONTS, { recursive: true, withFileTypes: true }))
      .filter((f) => f.isFile())
      .map((f) => relative(EXCALIDRAW_FONTS, resolve(f.parentPath, f.name)).split(sep).join('/'))
      .filter((path) => !SKIPPED_FONTS.has(path.split('/')[0]))
  return {
    name: 'aureum:excalidraw-fonts',
    configureServer(server) {
      server.middlewares.use('/excalidraw/fonts/', (req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '')
        if (path.includes('..') || SKIPPED_FONTS.has(path.split('/')[0])) return next()
        try {
          res.setHeader('Content-Type', 'font/woff2')
          res.end(readFileSync(resolve(EXCALIDRAW_FONTS, path)))
        } catch {
          next()
        }
      })
    },
    async generateBundle() {
      for (const path of await files()) {
        this.emitFile({ type: 'asset', fileName: `excalidraw/fonts/${path}`, source: await readFile(resolve(EXCALIDRAW_FONTS, path)) })
      }
    }
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [base64Import(), excalidrawFonts(), react(), tailwindcss()],
    // The repo's CHANGELOG.md is built into the app (Novidades in Home); the dev server may read it.
    server: { fs: { allow: [resolve(__dirname, '../..')] } }
  }
})
