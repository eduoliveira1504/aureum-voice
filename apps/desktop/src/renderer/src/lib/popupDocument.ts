/**
 * Windows the app opens with window.open('about:blank') and renders into with a React portal (the
 * overlay's widgets, the detached call window). They live in this same process: they read the same
 * stores and play the call's own tracks, without a second LiveKit connection.
 */

/** Gives the blank popup the app's styles and theme, and keeps them in sync; returns the cleanup. */
export function preparePopup(doc: Document, { title, transparent }: { title: string; transparent: boolean }): () => void {
  doc.title = title
  const base = doc.createElement('style')
  base.textContent = transparent
    ? 'html, body { background: transparent !important; overflow: hidden; height: 100%; margin: 0; }'
    : 'html, body { overflow: hidden; height: 100%; margin: 0; }'

  const syncStyles = (): void => {
    const copies = [...document.head.querySelectorAll<HTMLElement>('style, link[rel="stylesheet"]')].map((node) => {
      const copy = node.cloneNode(true) as HTMLElement
      // Relative URLs would resolve against about:blank.
      if (copy instanceof HTMLLinkElement) copy.href = (node as HTMLLinkElement).href
      return copy
    })
    doc.head.replaceChildren(...copies, base)
  }
  const syncTheme = (): void => {
    for (const { name } of [...doc.documentElement.attributes]) doc.documentElement.removeAttribute(name)
    for (const { name, value } of document.documentElement.attributes) doc.documentElement.setAttribute(name, value)
  }
  syncStyles()
  syncTheme()
  // Theme/accent changes, and stylesheets swapped by hot reload in development.
  const themeObserver = new MutationObserver(syncTheme)
  themeObserver.observe(document.documentElement, { attributes: true })
  const styleObserver = new MutationObserver(syncStyles)
  styleObserver.observe(document.head, { childList: true, subtree: true, characterData: true })
  return () => {
    themeObserver.disconnect()
    styleObserver.disconnect()
  }
}
