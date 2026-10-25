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

/**
 * Files from a package shipped with the app at `url`/ instead of coming from a CDN: served by the
 * dev server and copied into the build. Only files ending in `ext`; `skip` leaves out top-level folders.
 */
function vendorFiles({ url, dir, ext, type, skip = new Set() }: { url: string; dir: string; ext: string; type: string; skip?: Set<string> }): Plugin {
  const files = async (): Promise<string[]> =>
    (await readdir(dir, { recursive: true, withFileTypes: true }))
      .filter((f) => f.isFile() && f.name.endsWith(ext))
      .map((f) => relative(dir, resolve(f.parentPath, f.name)).split(sep).join('/'))
      .filter((path) => !skip.has(path.split('/')[0]))
  return {
    name: `aureum:vendor:${url}`,
    configureServer(server) {
      server.middlewares.use(`/${url}/`, (req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '')
        if (path.includes('..') || skip.has(path.split('/')[0])) return next()
        try {
          res.setHeader('Content-Type', type)
          res.end(readFileSync(resolve(dir, path)))
        } catch {
          next()
        }
      })
    },
    async generateBundle() {
      for (const path of await files()) {
        this.emitFile({ type: 'asset', fileName: `${url}/${path}`, source: await readFile(resolve(dir, path)) })
      }
    }
  }
}

// The whiteboard's fonts (Excalidraw's). Xiaolai (13 MB of Chinese handwriting) stays out; CJK
// text falls back to the system's fonts.
const excalidrawFonts = (): Plugin =>
  vendorFiles({
    url: 'excalidraw/fonts',
    dir: resolve(__dirname, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts'),
    ext: '.woff2',
    type: 'font/woff2',
    skip: new Set(['Xiaolai'])
  })

// Emojis look the same on every PC: Twemoji's drawings (CC-BY 4.0), see lib/emoji.ts.
const TWEMOJI = resolve(__dirname, 'node_modules/@twemoji/svg')
const twemoji = (): Plugin => vendorFiles({ url: 'twemoji', dir: TWEMOJI, ext: '.svg', type: 'image/svg+xml' })

/** `import names from 'virtual:twemoji-names'`: the drawings Twemoji has ("1f525", ...), so the
 * picker leaves out emojis it can't draw yet. Also used by the tests (vitest.config.mts). */
export function twemojiNames(): Plugin {
  const id = 'virtual:twemoji-names'
  return {
    name: 'aureum:twemoji-names',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    async load(source) {
      if (source !== `\0${id}`) return null
      const names = (await readdir(TWEMOJI)).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4))
      return `export default ${JSON.stringify(names)}`
    }
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [base64Import(), excalidrawFonts(), twemoji(), twemojiNames(), react(), tailwindcss()],
    // The repo's CHANGELOG.md is built into the app (Novidades in Home); the dev server may read it.
    server: { fs: { allow: [resolve(__dirname, '../..')] } }
  }
})
