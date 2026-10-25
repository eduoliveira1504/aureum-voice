import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

// Open modals, oldest first: Escape closes only the top one.
const openModals: object[] = []

/**
 * Never taller than the window: the body takes what's left and scrolls. `tall` (settings with
 * tabs) keeps one height across tabs and grows with big windows.
 */
export function Modal({
  title,
  subtitle,
  onClose,
  wide = false,
  tall = false,
  children
}: {
  title: string
  subtitle?: string
  onClose(): void
  wide?: boolean
  tall?: boolean
  children: ReactNode
}): ReactNode {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const me = {}
    openModals.push(me)
    const onKey = (e: KeyboardEvent): void => {
      // A modal opened over another (a confirmation, the crop editor) closes alone.
      if (e.key === 'Escape' && openModals.at(-1) === me) closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      openModals.splice(openModals.indexOf(me), 1)
    }
  }, [])

  return (
    <div className="app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-scrim/70 p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-full w-full min-w-0 flex-col ${tall ? 'h-[880px] max-w-[1040px]' : wide ? 'max-w-[760px]' : 'max-w-[440px]'} rounded-panel border border-line bg-panel p-6 shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="shrink-0 truncate text-center text-xl font-semibold">{title}</h2>
        {subtitle && <p className="mt-2 shrink-0 text-center text-sm text-fg-muted">{subtitle}</p>}
        <div className="mt-5 flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

/** The scrolling part of a modal with tabs or a footer: takes the height left over. */
export function ModalBody({ children }: { children: ReactNode }): ReactNode {
  return <div className="min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>
}

/**
 * A modal's tab strip. Labels never wrap or shrink; when they don't fit, the strip scrolls
 * sideways (mouse wheel too), fades at the hidden side and keeps the current tab in view.
 */
export function ModalTabs<T extends string>({
  tabs,
  isCurrent,
  onSelect
}: {
  /** [key, label, ...anything else the caller keeps there] */
  tabs: readonly (readonly [T, string, ...unknown[]])[]
  isCurrent(key: T): boolean
  onSelect(key: T): void
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState({ left: false, right: false })
  const current = tabs.find(([key]) => isCurrent(key))?.[0]

  useLayoutEffect(() => {
    const strip = ref.current
    if (!strip) return
    const measure = (): void =>
      setHidden({ left: strip.scrollLeft > 1, right: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1 })
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(strip)
    strip.addEventListener('scroll', measure)
    return () => {
      observer?.disconnect()
      strip.removeEventListener('scroll', measure)
    }
  }, [])

  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [current])

  return (
    <div className="relative mb-5 shrink-0 border-b border-line">
      <div
        ref={ref}
        role="tablist"
        onWheel={(e) => {
          if (ref.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) ref.current.scrollLeft += e.deltaY
        }}
        className="no-scrollbar -mb-px flex gap-1 overflow-x-auto"
      >
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isCurrent(key)}
            onClick={() => onSelect(key)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${isCurrent(key) ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {hidden.left && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-panel to-transparent" />}
      {hidden.right && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-panel to-transparent" />}
    </div>
  )
}

export function SecondaryButton({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>): ReactNode {
  return (
    <button
      {...props}
      className="w-full rounded-control bg-elevated px-4 py-2.5 text-[15px] font-medium text-fg hover:bg-line disabled:opacity-60"
    >
      {children}
    </button>
  )
}

export function DangerButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>): ReactNode {
  return (
    <button
      {...props}
      className="w-full rounded-control bg-danger px-4 py-2.5 text-[15px] font-semibold text-on-danger hover:bg-danger/85 disabled:opacity-60"
    >
      {children}
    </button>
  )
}

export function FormError({ message }: { message?: string | null }): ReactNode {
  if (!message) return null
  return (
    <div role="alert" className="rounded-control border border-danger/50 bg-danger/10 px-3 py-2 text-sm">
      {message}
    </div>
  )
}
