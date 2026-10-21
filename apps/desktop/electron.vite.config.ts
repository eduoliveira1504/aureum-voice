import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

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

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [base64Import(), react(), tailwindcss()],
    // The repo's CHANGELOG.md is built into the app (Novidades in Home); the dev server may read it.
    server: { fs: { allow: [resolve(__dirname, '../..')] } }
  }
})
