/**
 * Shortcut presses that reach the app even while a game has focus.
 *
 * Games can switch Windows' global hotkeys off while focused (League of Legends does), so
 * globalShortcut never hears them. While a watch is on, this polls the state of the keys of the
 * watched combos with GetAsyncKeyState, which games don't block (it's what OBS does too) and which
 * involves nothing inside the game process.
 *
 * Privacy rule (docs/decisions/0012-in-game-overlay.md): only the keys that make up the watched
 * combos are ever read — never any other key — and nothing about the keyboard is logged or kept;
 * the only output is "this combo was pressed". Polling runs only while someone asks for it (the
 * overlay: in a call with the overlay on; push-to-talk: in a call with it on) and stops after.
 */
import type koffiModule from 'koffi'

const POLL_MS = 25

const MODIFIER_VK: Record<string, number> = { Control: 0x11, Alt: 0x12, Shift: 0x10 }
const NAMED_VK: Record<string, number> = {
  Insert: 0x2d,
  Delete: 0x2e,
  Home: 0x24,
  End: 0x23,
  PageUp: 0x21,
  PageDown: 0x22,
  // Usual push-to-talk keys (not valid in accelerators, only read here).
  Backquote: 0xc0,
  CapsLock: 0x14,
  Mouse4: 0x05, // VK_XBUTTON1, the mouse's back side button
  Mouse5: 0x06 // VK_XBUTTON2
}

/** Virtual-key codes of an Electron accelerator such as "Control+Shift+F9", or null if unsupported. */
export function virtualKeys(accelerator: string): number[] | null {
  const codes = accelerator.split('+').map((part) => {
    if (part in MODIFIER_VK) return MODIFIER_VK[part]
    if (part in NAMED_VK) return NAMED_VK[part]
    if (/^[A-Z0-9]$/.test(part)) return part.charCodeAt(0) // VK_A..VK_Z, VK_0..VK_9 match ASCII
    const f = /^F([1-9]|1[0-9]|2[0-4])$/.exec(part)
    return f ? 0x6f + Number(f[1]) : null // VK_F1 = 0x70
  })
  return codes.every((c): c is number => c !== null) ? codes : null
}

type IsDown = (vk: number) => boolean
let isDown: IsDown | null | undefined

/** GetAsyncKeyState through koffi, loaded the first time a watch starts (Windows only). */
function loadIsDown(): IsDown | null {
  if (isDown !== undefined) return isDown
  isDown = null
  if (process.platform !== 'win32') return isDown
  try {
    const koffi = require('koffi') as typeof koffiModule
    const getAsyncKeyState = koffi.load('user32.dll').func('short __stdcall GetAsyncKeyState(int vKey)')
    // The high bit is set while the key is held down.
    isDown = (vk) => (getAsyncKeyState(vk) & 0x8000) !== 0
  } catch (err) {
    console.warn('Key watch unavailable', err)
  }
  return isDown
}

export interface WatchedCombo {
  accelerator: string
  onPress(): void
  /** When the combo stops being held (push-to-talk). */
  onRelease?(): void
}

/**
 * Calls each combo's onPress once when all its keys are down (not again until it's released),
 * and onRelease when they stop being held. Returns a function that stops the watch (a combo
 * still held then gets its onRelease). Unsupported accelerators are ignored.
 */
export function watchCombos(combos: WatchedCombo[]): () => void {
  const read = loadIsDown()
  const watched = combos
    // `pressed`: onPress fired and onRelease is still due.
    .map((c) => ({ ...c, keys: virtualKeys(c.accelerator), held: true, pressed: false }))
    .filter((c): c is WatchedCombo & { keys: number[]; held: boolean; pressed: boolean } => c.keys !== null)
  if (!read || watched.length === 0) return () => {}

  // Each key is read at most once per tick, and only keys that belong to a watched combo.
  const keys = [...new Set(watched.flatMap((c) => c.keys))]
  const timer = setInterval(() => {
    const down = new Set(keys.filter(read))
    for (const combo of watched) {
      const all = combo.keys.every((k) => down.has(k))
      // `held` starts true, so a combo already held when the watch starts doesn't fire.
      if (all && !combo.held) {
        combo.pressed = true
        combo.onPress()
      } else if (!all && combo.pressed) {
        combo.pressed = false
        combo.onRelease?.()
      }
      combo.held = all
    }
  }, POLL_MS)
  return () => {
    clearInterval(timer)
    for (const combo of watched) if (combo.pressed) combo.onRelease?.()
  }
}
