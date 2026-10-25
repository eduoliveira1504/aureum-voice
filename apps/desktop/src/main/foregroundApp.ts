/**
 * The executable name of the window in front ("vivaldi", "league of legends"), so the overlay
 * shows only over games.
 *
 * Privacy rule (docs/decisions/0012-in-game-overlay.md): only the program's file name is read —
 * never the window title or anything inside the program — and it is only compared, in this
 * process, against the game and exception lists. To ask "Isso é um jogo?" about an unknown program
 * that fills the screen, the window's rectangle is compared with its monitor's, and that's all. It never goes to the server, to the app's window
 * or to a log. Asked at most once a second, only while in a call with the overlay on (see overlay.ts).
 */
import type koffiModule from 'koffi'

import { appKey } from '../shared/overlayRule'

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const MAX_PATH_CHARS = 1024

const MONITOR_DEFAULTTONEAREST = 2

interface Reader {
  name(): string | null
  fillsMonitor(): boolean
}
let reader: Reader | null | undefined

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** GetForegroundWindow → its process id → the process image path, through koffi (Windows only). */
function load(): Reader | null {
  if (reader !== undefined) return reader
  reader = null
  if (process.platform !== 'win32') return reader
  try {
    const koffi = require('koffi') as typeof koffiModule
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    const getForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()')
    const getWindowThreadProcessId = user32.func(
      'uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *lpdwProcessId)'
    )
    const openProcess = kernel32.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)')
    const queryImageName = kernel32.func(
      'int __stdcall QueryFullProcessImageNameW(void *hProcess, uint32_t flags, void *exeName, _Inout_ uint32_t *size)'
    )
    const closeHandle = kernel32.func('int __stdcall CloseHandle(void *handle)')
    const RECT = koffi.struct('RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' })
    const MONITORINFO = koffi.struct('MONITORINFO', { cbSize: 'uint32_t', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32_t' })
    const getWindowRect = user32.func('int __stdcall GetWindowRect(void *hWnd, _Out_ RECT *rect)')
    const monitorFromWindow = user32.func('void * __stdcall MonitorFromWindow(void *hWnd, uint32_t flags)')
    const getMonitorInfo = user32.func('int __stdcall GetMonitorInfoW(void *hMonitor, _Inout_ MONITORINFO *info)')
    const buffer = Buffer.alloc(MAX_PATH_CHARS * 2)

    const name = (): string | null => {
      const hwnd = getForegroundWindow()
      if (!hwnd) return null
      const pid = [0]
      getWindowThreadProcessId(hwnd, pid)
      if (!pid[0]) return null
      const handle = openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid[0])
      if (!handle) return null // e.g. a protected program: unknown (see overGame)
      try {
        const size = [MAX_PATH_CHARS]
        if (!queryImageName(handle, 0, buffer, size)) return null
        return appKey(buffer.toString('utf16le', 0, size[0] * 2))
      } finally {
        closeHandle(handle)
      }
    }
    // Borderless and exclusive fullscreen windows cover their monitor exactly; a maximized one
    // stops at the taskbar and has invisible borders past the screen's edge.
    const fillsMonitor = (): boolean => {
      const hwnd = getForegroundWindow()
      if (!hwnd) return false
      const rect = {} as Rect
      if (!getWindowRect(hwnd, rect)) return false
      const monitor = monitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
      const info = { cbSize: koffi.sizeof(MONITORINFO) } as { cbSize: number; rcMonitor: Rect }
      if (!monitor || !getMonitorInfo(monitor, info)) return false
      const m = info.rcMonitor
      return rect.left === m.left && rect.top === m.top && rect.right === m.right && rect.bottom === m.bottom
    }
    reader = { name, fillsMonitor }
  } catch (err) {
    console.warn('Foreground app check unavailable', err)
  }
  return reader
}

/** The name of the program in front, or null if it can't be told. */
export function foregroundApp(): string | null {
  try {
    return load()?.name() ?? null
  } catch {
    return null
  }
}

/** Whether the window in front covers its whole monitor (only its rectangle is read). */
export function foregroundFillsMonitor(): boolean {
  try {
    return load()?.fillsMonitor() ?? false
  } catch {
    return false
  }
}
