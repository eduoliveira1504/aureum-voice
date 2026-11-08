/** Image types the chat shows, and the extension each one is saved with (3.24 B). */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp'
}

const KNOWN = new Set([...Object.values(EXTENSIONS), 'jpeg'])

/** Biggest image the app copies or saves (attachments go up to 25 MB; room for a decoded PNG). */
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024

/** Characters Windows doesn't allow in file names, and the reserved device names. */
const BAD_CHARS = /[<>:"/\|?*\u0000-\u001f]/g
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

/**
 * The name "Salvar como" suggests: the original name, cleaned for Windows, with the extension of
 * what the file really is (a .png name on a WebP gets .webp).
 */
export function imageFileName(name: string, contentType: string): string {
  let ext = EXTENSIONS[contentType.split(';')[0].trim().toLowerCase()] ?? 'png'
  const clean = name.replace(BAD_CHARS, '').trim().replace(/[. ]+$/, '')
  const dot = clean.lastIndexOf('.')
  const current = dot > 0 ? clean.slice(dot + 1).toLowerCase() : ''
  let stem = clean
  if (current === ext || (ext === 'jpg' && current === 'jpeg')) {
    stem = clean.slice(0, dot)
    ext = current
  } else if (KNOWN.has(current)) {
    stem = clean.slice(0, dot)
  }
  stem = stem.slice(0, 200).trim()
  if (!stem || RESERVED.test(stem)) stem = 'imagem'
  return `${stem}.${ext}`
}
