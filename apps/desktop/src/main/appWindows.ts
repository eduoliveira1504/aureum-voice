/**
 * The windows the app opens besides the main one: the overlay's widgets (overlay.ts), the detached
 * call (callWindow.ts) and the loading screen. They float over other programs and show other
 * people's cameras, voices and messages, who didn't agree to be streamed, so all of them are kept
 * out of screenshots and screen sharing (Windows 10 2004+; see 3.24 A for older Windows).
 */
import type { BrowserWindow } from 'electron'

import { isCallFrame } from '../shared/callWindow'
import * as callWindow from './callWindow'
import * as overlay from './overlay'

/** Set before the window first shows: Chromium applies it to the window as it shows. */
export function protectFromCapture(win: Pick<BrowserWindow, 'setContentProtection'>): void {
  win.setContentProtection(true)
}

/** Takes over a window the app's window just opened with window.open() (see setWindowOpenHandler). */
export function adoptPopup(created: BrowserWindow, frameName: string): void {
  protectFromCapture(created)
  const widget = overlay.widgetOfFrame(frameName)
  if (widget) overlay.attachWindow(widget, created)
  else if (isCallFrame(frameName)) void callWindow.attachWindow(created)
}
