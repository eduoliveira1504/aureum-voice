/// <reference types="vite/client" />
/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  /** Default API server baked into a build (e.g. the public plan-B address). */
  readonly MAIN_VITE_API_URL?: string
}
