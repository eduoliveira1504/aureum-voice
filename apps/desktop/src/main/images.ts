/**
 * "Copiar imagem" and "Salvar imagem como…" from the chat (3.24 B). The app's window sends the
 * bytes it already loaded (through the same cache and token as showing the image), so nothing here
 * downloads anything: an image someone can't see never gets here by another route.
 */
import { writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { app, clipboard, ClipboardItem, dialog, nativeImage, type BrowserWindow } from 'electron'

import { imageFileName, MAX_IMAGE_BYTES } from '../shared/imageFiles'

function bytesOf(data: unknown): Buffer {
  if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('Invalid image')
  }
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

/** Puts the image on the clipboard as an image (pastes in the chat, WhatsApp, Paint). `png` is the
 * picture decoded by the app's window (the first frame of a GIF, as in browsers). */
export async function copyImage(png: unknown): Promise<void> {
  // Decoded again here, so only a real picture reaches the clipboard. Electron 44 dropped
  // clipboard.writeImage: an image/png ClipboardItem is its way to put an image there.
  const image = nativeImage.createFromBuffer(bytesOf(png))
  if (image.isEmpty()) throw new Error('Invalid image')
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) })])
}

/** Windows' "Salvar como", with the original name and the right extension; false if cancelled. */
export async function saveImage(win: BrowserWindow | null, data: unknown, name: unknown, contentType: unknown): Promise<boolean> {
  const bytes = bytesOf(data)
  const fileName = imageFileName(typeof name === 'string' ? name : '', typeof contentType === 'string' ? contentType : '')
  const ext = extname(fileName).slice(1)
  const options = {
    defaultPath: join(app.getPath('downloads'), fileName),
    filters: [{ name: 'Imagem', extensions: [ext] }]
  }
  const { canceled, filePath } = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options))
  if (canceled || !filePath) return false
  await writeFile(filePath, bytes)
  return true
}
