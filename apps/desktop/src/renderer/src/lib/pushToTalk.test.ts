import { describe, expect, it } from 'vitest'

import { pttKeyLabel, pttKeyOfKeyboard, pttKeyOfMouse } from './pushToTalk'

describe('push-to-talk keys', () => {
  it('maps key presses to the names the key watch reads', () => {
    expect(pttKeyOfKeyboard('KeyV')).toBe('V')
    expect(pttKeyOfKeyboard('Digit4')).toBe('4')
    expect(pttKeyOfKeyboard('F13')).toBe('F13')
    expect(pttKeyOfKeyboard('ControlRight')).toBe('Control')
    expect(pttKeyOfKeyboard('Backquote')).toBe('Backquote')
    expect(pttKeyOfKeyboard('Space')).toBeNull()
    expect(pttKeyOfKeyboard('Enter')).toBeNull()
  })

  it('takes the side mouse buttons only', () => {
    expect(pttKeyOfMouse(3)).toBe('Mouse4')
    expect(pttKeyOfMouse(4)).toBe('Mouse5')
    expect(pttKeyOfMouse(0)).toBeNull()
    expect(pttKeyOfMouse(2)).toBeNull()
  })

  it('labels keys for people', () => {
    expect(pttKeyLabel('Mouse4')).toBe('Mouse 4 (lateral)')
    expect(pttKeyLabel('Control')).toBe('Ctrl')
    expect(pttKeyLabel('V')).toBe('V')
  })
})
