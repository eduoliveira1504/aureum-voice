import { describe, expect, it } from 'vitest'

import { imageFileName } from './imageFiles'

describe('imageFileName', () => {
  it('keeps the original name and its extension', () => {
    expect(imageFileName('print da partida.png', 'image/png')).toBe('print da partida.png')
    expect(imageFileName('foto.JPEG', 'image/jpeg')).toBe('foto.jpeg')
  })

  it('uses the extension of what the file really is', () => {
    expect(imageFileName('meme.png', 'image/webp')).toBe('meme.webp')
    expect(imageFileName('sticker', 'image/webp')).toBe('sticker.webp')
    expect(imageFileName('v1.2 final', 'image/gif')).toBe('v1.2 final.gif')
  })

  it('cleans what Windows does not allow in a name', () => {
    expect(imageFileName('a/b:c*?.png', 'image/png')).toBe('abc.png')
    expect(imageFileName('CON.png', 'image/png')).toBe('imagem.png')
    expect(imageFileName('', 'image/jpeg')).toBe('imagem.jpg')
    expect(imageFileName('x'.repeat(300) + '.png', 'image/png')).toBe('x'.repeat(200) + '.png')
  })
})
