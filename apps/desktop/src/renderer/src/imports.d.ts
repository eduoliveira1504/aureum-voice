declare module '*?base64' {
  /** The file's bytes, base64-encoded (see base64Import in electron.vite.config.ts). */
  const data: string
  export default data
}

declare module 'virtual:twemoji-names' {
  /** File names (without .svg) of the emoji drawings shipped with the app. */
  const names: string[]
  export default names
}
