import { Check, ChevronRight, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react'
import { create } from 'zustand'

import { menuClass, MenuItem } from './ui'

/**
 * Right-click menus. One menu is open at a time, rendered by <ContextMenuHost /> at the
 * pointer and kept on screen. Its content is built when it opens, so items reflect the
 * permissions and state of that moment.
 */

interface MenuState {
  menu: { x: number; y: number; content: () => ReactNode } | null
  open(x: number, y: number, content: () => ReactNode): void
  close(): void
}

const useMenu = create<MenuState>()((set) => ({
  menu: null,
  open: (x, y, content) => set({ menu: { x, y, content } }),
  close: () => set({ menu: null })
}))

export const closeContextMenu = (): void => useMenu.getState().close()

/** Where the open menu was opened (to place what its items open, like a profile card). */
export function menuPoint(): DOMRect {
  const menu = useMenu.getState().menu
  return new DOMRect(menu?.x ?? window.innerWidth / 2, menu?.y ?? window.innerHeight / 3, 0, 0)
}

/**
 * Dialogs opened from menus (confirmations, a nickname, settings): the menu is gone by then,
 * so they live in the host. `render` gets the function that closes the dialog.
 */
const useDialog = create<{ render: ((close: () => void) => ReactNode) | null }>()(() => ({ render: null }))

export function showDialog(render: (close: () => void) => ReactNode): void {
  useDialog.setState({ render })
}

/** A short confirmation at the bottom of the window ("Copiado!"). */
const useToast = create<{ text: string | null; id: number }>()(() => ({ text: null, id: 0 }))

export function toast(text: string): void {
  useToast.setState((s) => ({ text, id: s.id + 1 }))
}

/** Copies text and says so. */
export function copy(text: string, what = 'Copiado'): void {
  navigator.clipboard.writeText(text).then(
    () => toast(`${what}!`),
    () => toast('Não foi possível copiar.')
  )
}

const TOAST_MS = 2000

function Toast(): ReactNode {
  const { text, id } = useToast()
  useEffect(() => {
    if (!text) return
    const timer = setTimeout(() => useToast.setState({ text: null }), TOAST_MS)
    return () => clearTimeout(timer)
  }, [text, id])
  if (!text) return null
  return (
    <div role="status" className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-control bg-fg px-4 py-2 text-sm font-medium text-rail shadow-xl">
      {text}
    </div>
  )
}

function Dialog(): ReactNode {
  const render = useDialog((s) => s.render)
  return render ? render(() => useDialog.setState({ render: null })) : null
}

/** onContextMenu handler that opens a menu with `content`. */
export function contextMenu(content: () => ReactNode) {
  return (e: ReactMouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    useMenu.getState().open(e.clientX, e.clientY, content)
  }
}

/** Opens a menu under an element (for "more" buttons that show the same menu). */
export function openMenuAt(target: Element, content: () => ReactNode): void {
  const rect = target.getBoundingClientRect()
  useMenu.getState().open(rect.left, rect.bottom + 4, content)
}

/** Keeps a floating box inside the window. */
function useOnScreen(x: number, y: number): [RefObject<HTMLDivElement | null>, { left: number; top: number }] {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8))
    })
  }, [x, y])
  return [ref, pos]
}

export function ContextMenuHost(): ReactNode {
  const menu = useMenu((s) => s.menu)
  const close = useMenu((s) => s.close)

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menu, close])

  return (
    <>
      {menu && <OpenMenu x={menu.x} y={menu.y} content={menu.content} close={close} />}
      <Dialog />
      <Toast />
    </>
  )
}

function OpenMenu({ x, y, content, close }: { x: number; y: number; content: () => ReactNode; close(): void }): ReactNode {
  return (
    <div
      className="fixed inset-0 z-50"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onContextMenu={(e) => {
        e.preventDefault()
        close()
      }}
      onWheel={(e) => e.target === e.currentTarget && close()}
    >
      <MenuBox key={`${x},${y}`} x={x} y={y}>
        {content()}
      </MenuBox>
    </div>
  )
}

function MenuBox({ x, y, children }: { x: number; y: number; children: ReactNode }): ReactNode {
  const [ref, pos] = useOnScreen(x, y)
  return (
    <div ref={ref} role="menu" style={pos} className={`${menuClass} fixed w-60 max-h-[calc(100vh-16px)] overflow-y-auto`}>
      {children}
    </div>
  )
}

/** A menu item that also closes the menu. */
export function Item({
  icon,
  label,
  hint,
  danger,
  onClick
}: {
  icon?: LucideIcon
  label: string
  hint?: string
  danger?: boolean
  onClick(): void
}): ReactNode {
  return (
    <MenuItem
      icon={icon}
      label={label}
      hint={hint}
      danger={danger}
      onClick={() => {
        onClick() // first: it may read menuPoint()
        closeContextMenu()
      }}
    />
  )
}

/** On/off item; stays open so several can be toggled. */
export function CheckItem({ label, checked, color, onChange }: { label: string; checked: boolean; color?: string | null; onChange(): void }): ReactNode {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onChange}
      className="flex w-full items-center gap-2.5 rounded-item px-2 py-1.5 text-left text-sm text-fg-muted hover:bg-elevated hover:text-fg"
    >
      {color !== undefined && (
        <span className="h-3 w-3 shrink-0 rounded-full border border-line" style={color ? { background: color } : undefined} />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}>
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
    </button>
  )
}

export function Separator(): ReactNode {
  return <div role="separator" className="my-1 h-px bg-line" />
}

export function Label({ children }: { children: ReactNode }): ReactNode {
  return <p className="truncate px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{children}</p>
}

/** Opens its items beside the menu on hover (or click). */
export function Submenu({ icon: Icon, label, children }: { icon?: LucideIcon; label: string; children: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = (): void => {
    clearTimeout(timer.current)
    setAnchor(ref.current?.getBoundingClientRect() ?? null)
    setOpen(true)
  }
  const hide = (): void => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(false), 200)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <div ref={ref} onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={show}
        className={`flex w-full items-center gap-2.5 rounded-item px-2 py-1.5 text-left text-sm ${open ? 'bg-elevated text-fg' : 'text-fg-muted hover:bg-elevated hover:text-fg'}`}
      >
        {Icon && <Icon size={16} className="shrink-0" />}
        <span className="flex-1 truncate">{label}</span>
        <ChevronRight size={14} className="shrink-0" />
      </button>
      {open && anchor && (
        <SubmenuBox anchor={anchor} onEnter={show} onLeave={hide}>
          {children}
        </SubmenuBox>
      )}
    </div>
  )
}

function SubmenuBox({ anchor, onEnter, onLeave, children }: { anchor: DOMRect; onEnter(): void; onLeave(): void; children: ReactNode }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: anchor.right + 4, top: anchor.top - 6 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    // To the right, or to the left when there's no room.
    const left = anchor.right + 4 + width > window.innerWidth - 8 ? anchor.left - width - 4 : anchor.right + 4
    setPos({ left: Math.max(8, left), top: Math.max(8, Math.min(anchor.top - 6, window.innerHeight - height - 8)) })
  }, [anchor])
  return (
    <div
      ref={ref}
      role="menu"
      style={pos}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={`${menuClass} fixed w-56 max-h-[60vh] overflow-y-auto`}
    >
      {children}
    </div>
  )
}

/** A labeled range input inside a menu (e.g. a person's volume). */
export function SliderItem({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format(value: number): string
  onChange(value: number): void
}): ReactNode {
  // Local while dragging, so the menu doesn't wait for the store to re-render.
  const [current, setCurrent] = useState(value)
  return (
    <label className="block px-2 py-1.5">
      <span className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        {label}
        <span className="font-sans text-sm normal-case tracking-normal text-fg tabular-nums">{format(current)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(e) => {
          setCurrent(Number(e.target.value))
          onChange(Number(e.target.value))
        }}
        className="mt-1.5 w-full accent-accent"
      />
    </label>
  )
}
