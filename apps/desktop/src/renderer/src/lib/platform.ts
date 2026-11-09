/**
 * Windows or Mac (block 3.21). The Mac uses Cmd where Windows uses Ctrl, both in what the app
 * listens to and in the hints it shows, and has no overlay, game detection or push-to-talk.
 */

export const isMac = (): boolean => window.aureum?.platform === 'darwin'

/** The app's modifier is held: Ctrl on Windows, Cmd on the Mac (and not the other one). */
export const modHeld = (e: { ctrlKey: boolean; metaKey: boolean }): boolean =>
  isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey

/** A shortcut as written for Windows ("Ctrl+Shift+R", "Ctrl K"), as it reads on this platform. */
export const shortcut = (keys: string): string => (isMac() ? keys.replace(/\bCtrl\b/g, 'Cmd') : keys)
