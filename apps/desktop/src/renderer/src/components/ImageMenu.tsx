import { Copy, Download, Link, Maximize2 } from 'lucide-react'
import { createContext, useContext, type MouseEvent, type ReactNode } from 'react'

import { copyImage, openImages, saveImage, type ChatImage, type ViewableImage } from '../lib/chatImages'
import { contextMenu, copy, Item, Separator, toast } from './ContextMenu'

/**
 * The message an image is in gives its menu items here, so a right click on the image shows the
 * image's options and, under them, the message's (3.24 B). Null outside a message (the viewer).
 */
export const MessageMenuContext = createContext<(() => ReactNode) | null>(null)

/** What "Abrir imagem" opens: the image alone, or the message's images starting at this one. */
export interface ImageGallery {
  images: ViewableImage[]
  index: number
}

export function ImageMenuItems({ image, gallery }: { image: ChatImage; gallery?: ImageGallery | null }): ReactNode {
  if (image.kind === 'gif') return <Item icon={Link} label="Copiar link do GIF" onClick={() => copy(image.url, 'Link do GIF copiado')} />
  const run = (action: Promise<unknown>, done: string | null, failed: string): void =>
    void action.then(
      (ok) => done && ok !== false && toast(done),
      () => toast(failed)
    )
  return (
    <>
      <Item icon={Copy} label="Copiar imagem" onClick={() => run(copyImage(image), 'Imagem copiada!', 'Não foi possível copiar a imagem.')} />
      <Item icon={Download} label="Salvar imagem como…" onClick={() => run(saveImage(image), null, 'Não foi possível salvar a imagem.')} />
      {gallery !== null && (
        <Item icon={Maximize2} label="Abrir imagem" onClick={() => (gallery ? openImages(gallery.images, gallery.index) : openImages([image]))} />
      )}
    </>
  )
}

/**
 * onContextMenu for a chat image: its options, then the message's. `gallery` null leaves out
 * "Abrir imagem" (in the viewer, it's already open).
 */
export function useImageMenu(image: ChatImage, gallery?: ImageGallery | null): (e: MouseEvent) => void {
  const messageItems = useContext(MessageMenuContext)
  return contextMenu(() => (
    <>
      <ImageMenuItems image={image} gallery={gallery} />
      {messageItems && (
        <>
          <Separator />
          {messageItems()}
        </>
      )}
    </>
  ))
}
