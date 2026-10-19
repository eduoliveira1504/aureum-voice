/**
 * Push-to-talk keys: a single key, read by the main process while a call needs it (see
 * src/main/keyWatch.ts for the names it knows). Picked in Settings > Voz e vídeo.
 */

const NAMED = /^(F([1-9]|1[0-9]|2[0-4])|Insert|Delete|Home|End|PageUp|PageDown|Backquote|CapsLock)$/
const MODIFIERS: Record<string, string> = {
  ControlLeft: 'Control',
  ControlRight: 'Control',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift'
}

/** The key name for a key press, or null if it can't be a push-to-talk key. */
export function pttKeyOfKeyboard(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (NAMED.test(code)) return code
  return MODIFIERS[code] ?? null
}

/** The mouse's side buttons (MouseEvent.button 3 and 4). */
export function pttKeyOfMouse(button: number): string | null {
  return button === 3 ? 'Mouse4' : button === 4 ? 'Mouse5' : null
}

const LABELS: Record<string, string> = {
  Control: 'Ctrl',
  Backquote: '`',
  CapsLock: 'Caps Lock',
  Mouse4: 'Mouse 4 (lateral)',
  Mouse5: 'Mouse 5 (lateral)',
  PageUp: 'Page Up',
  PageDown: 'Page Down'
}

export function pttKeyLabel(key: string): string {
  return LABELS[key] ?? key
}
