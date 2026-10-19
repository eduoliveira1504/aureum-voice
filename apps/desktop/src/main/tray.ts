/**
 * The Windows tray icon that keeps the app reachable while its window is hidden: a click opens
 * it, and the menu mutes, deafens, sets the status or quits for real. The renderer reports
 * what to show (setTrayState) and runs what the menu asks (the onCommand callback).
 */

import { Menu, nativeImage, Tray, type MenuItemConstructorOptions, type NativeImage } from 'electron'

import type { TrayCommand, TrayState, TrayStatus } from '../shared/types'

const STATUSES: { value: TrayStatus; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'idle', label: 'Ausente' },
  { value: 'dnd', label: 'Não perturbe' },
  { value: 'invisible', label: 'Invisível' }
]

let tray: Tray | null = null
let state: TrayState = { signedIn: false, muted: false, deafened: false, status: 'online' }
let handlers: { open(): void; quit(): void; command(cmd: TrayCommand): void } | null = null

/** A gold coin (the default accent) with a dark center, drawn here so no icon file is needed. */
function icon(): NativeImage {
  const size = 32
  const buf = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      const outer = Math.min(1, Math.max(0, 15.5 - d)) // anti-aliased edges
      const hole = Math.min(1, Math.max(0, 5.5 - d))
      const i = (y * size + x) * 4
      // BGRA: gold #E8B531 blending into a dark center #1A1408.
      buf[i] = Math.round(0x31 * (1 - hole) + 0x08 * hole)
      buf[i + 1] = Math.round(0xb5 * (1 - hole) + 0x14 * hole)
      buf[i + 2] = Math.round(0xe8 * (1 - hole) + 0x1a * hole)
      buf[i + 3] = Math.round(255 * outer)
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 })
}

function menu(): Menu {
  const items: MenuItemConstructorOptions[] = [{ label: 'Abrir Aureum', click: () => handlers?.open() }]
  if (state.signedIn) {
    items.push(
      { type: 'separator' },
      { label: 'Silenciar microfone', type: 'checkbox', checked: state.muted, click: () => handlers?.command({ type: 'mute' }) },
      { label: 'Ensurdecer', type: 'checkbox', checked: state.deafened, click: () => handlers?.command({ type: 'deafen' }) },
      {
        label: 'Status',
        submenu: STATUSES.map(({ value, label }) => ({
          label,
          type: 'radio' as const,
          checked: state.status === value,
          click: () => handlers?.command({ type: 'status', status: value })
        }))
      }
    )
  }
  items.push({ type: 'separator' }, { label: 'Sair do Aureum', click: () => handlers?.quit() })
  return Menu.buildFromTemplate(items)
}

export function createTray(h: NonNullable<typeof handlers>): void {
  handlers = h
  tray = new Tray(icon())
  tray.setToolTip('Aureum Voice')
  tray.setContextMenu(menu())
  tray.on('click', () => handlers?.open())
}

export function setTrayState(next: unknown): void {
  if (!next || typeof next !== 'object') throw new Error('Invalid tray state')
  const s = next as Partial<TrayState>
  state = {
    signedIn: s.signedIn === true,
    muted: s.muted === true,
    deafened: s.deafened === true,
    status: STATUSES.some((x) => x.value === s.status) ? (s.status as TrayStatus) : 'online'
  }
  tray?.setContextMenu(menu())
}

/** A one-time hint next to the tray icon ("still running here"). */
export function notify(title: string, content: string): void {
  tray?.displayBalloon({ title, content, iconType: 'info' })
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
