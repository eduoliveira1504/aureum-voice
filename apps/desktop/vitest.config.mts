import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vitest/config'

/** `?base64` imports (the RNNoise WebAssembly) aren't needed by component tests: empty stand-in. */
const base64Stub: Plugin = {
  name: 'aureum:base64-stub',
  enforce: 'pre',
  load: (id) => (id.endsWith('?base64') ? 'export default ""' : null)
}

// Component tests for the renderer (npm test). They run in jsdom with a fake window.aureum
// bridge (src/renderer/src/test/setup.ts); nothing talks to the API.
export default defineConfig({
  plugins: [base64Stub, react()],
  test: {
    environment: 'jsdom',
    include: ['src/renderer/src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/renderer/src/test/setup.ts']
  }
})
