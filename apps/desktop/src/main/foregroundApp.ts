/**
 * The executable name of the window in front ("vivaldi", "league of legends"), so the overlay
 * can stay out of browsers and other non-game apps.
 *
 * Privacy rule (docs/decisions/0012-in-game-overlay.md): only the program's file name is read —
 * never the window title or anything inside the program — and it is only compared, in this
 * process, against the exception lists. It never goes to the server, to the app's window or to
 * a log. Asked at most once a second, only while in a call with the overlay on (see overlay.ts).
 */
import { basename } from 'node:path'

import type koffiModule from 'koffi'

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const MAX_PATH_CHARS = 1024

type Reader = () => string | null
let reader: Reader | null | undefined

/** "C:\\Games\\Riot\\League of Legends.exe" -> "league of legends" */
export const appName = (file: string): string => basename(file.replace(/\\/g, '/')).replace(/\.exe$/i, '').trim().toLowerCase()

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
    const buffer = Buffer.alloc(MAX_PATH_CHARS * 2)

    reader = () => {
      const hwnd = getForegroundWindow()
      if (!hwnd) return null
      const pid = [0]
      getWindowThreadProcessId(hwnd, pid)
      if (!pid[0]) return null
      const handle = openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid[0])
      if (!handle) return null // e.g. an elevated program: unknown, treated as a game
      try {
        const size = [MAX_PATH_CHARS]
        if (!queryImageName(handle, 0, buffer, size)) return null
        return appName(buffer.toString('utf16le', 0, size[0] * 2))
      } finally {
        closeHandle(handle)
      }
    }
  } catch (err) {
    console.warn('Foreground app check unavailable', err)
  }
  return reader
}

/** The name of the program in front, or null if it can't be told. */
export function foregroundApp(): string | null {
  try {
    return load()?.() ?? null
  } catch {
    return null
  }
}
